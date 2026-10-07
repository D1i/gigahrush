// QA «без затемнения вдали» во вкладке «3D», источник «Прогулка» (бесконечный мир, портальный рендер, тумана нет):
//  1) «дыры в пустоту»: авто-ходьба через N порогов (камера с коллизиями идёт к проёму и сквозь него); в каждой
//     комнате 8 видов (6 из середины комнаты по кругу + 2 от входа вперёд). Каждый вид рисуется 3 раза: порталы
//     с фоном пурпурным и зелёным (P, P') и R — области проёмов залиты голубым, комнаты за ними не рисуются.
//     Пиксели, где P и P' различаются, — фон. Фон в области проёма (голубое в R) — дыра в пустоту (сквозь проём
//     не нарисовано ничего); фон вне областей (пурпурное в R) — трещина в геометрии своей комнаты (к порталам
//     отношения не имеет, считается отдельно). Доля дыр = дыры / площадь областей проёмов. Цель — 0 почти во
//     всех кадрах;
//  2) производительность: те же комнаты, 4 взгляда, по 30 кадров — без тумана (по умолчанию) и с туманом на
//     sightM (необязательная атмосфера; тогда рендер не открывает проёмы за туманом — как было раньше):
//     draw calls, мс на кадр, комнат и проёмов в кадре;
//  3) снимки самых «глубоких» видов (больше всего комнат сквозь проёмы) — без тумана и с туманом.
// node tools/qa-3d-nofog.mjs [url] [seed] [порогов]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5213/';
const seed = process.argv[3] ?? 'qa-nofog-1';
const want = Number(process.argv[4] ?? 24);
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
const t00 = Date.now();

for (let k = 0; k < 5; k++) {
  try {
    await page.goto(url, { timeout: 180000 });
    break;
  } catch (e) {
    console.log('goto:', String(e.message).slice(0, 100));
    await wait(3000);
  }
}
// чистый старт: прогулка этого сида, без сохранений; настройки вида по умолчанию (туман выкл.)
await page.evaluate((seed) => {
  for (const k of Object.keys(localStorage)) if (k.startsWith('room-forge/world/') || k === 'room-forge/walk' || k === 'room-forge/blockout-view') localStorage.removeItem(k);
  localStorage.setItem('room-forge/walk', JSON.stringify({ seed, deadEndChance: 0.15, branching: 1, aheadDoors: 2, on: true }));
}, seed);
await page.reload({ timeout: 180000 });
await wait(1200);
await page.getByRole('button', { name: '3D', exact: true }).click();
await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 120000 });
await wait(1500);

// ── помощники в странице ──
await page.evaluate(() => {
  const v = window.__rf3d, sc = v.scene, eng = v.engine, cam = v.fps;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const grab = () => new Promise((res) => sc.onAfterRenderObservable.addOnce(() => eng.readPixels(0, 0, eng.getRenderWidth(), eng.getRenderHeight()).then((px) => res(new Uint8Array(px.buffer.slice(0))))));
  const C4 = sc.clearColor.constructor;
  const bg0 = sc.clearColor.clone();
  const setBg = (r, g, b) => (sc.clearColor = new C4(r, g, b, 1));
  const ready = async () => {
    const d = window.__rf3dFold;
    for (let k = 0; k < 120; k++) {
      await frame();
      if (d.portal.allReady()) break;
    }
    for (let k = 0; k < 2; k++) await frame();
  };
  const png = (buf, W, H, mask) => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = ((H - 1 - y) * W + x) * 4, o = (y * W + x) * 4;
        if (mask && mask[(H - 1 - y) * W + x]) (data[o] = 255), (data[o + 1] = 0), (data[o + 2] = 255);
        else (data[o] = buf[i]), (data[o + 1] = buf[i + 1]), (data[o + 2] = buf[i + 2]);
        data[o + 3] = 255;
      }
    }
    g.putImageData(new ImageData(data, W, H), 0, 0);
    return cv.toDataURL('image/png');
  };
  /** Вид: дыры в областях проёмов, трещины своей комнаты (см. шапку), статистика портального рендера. */
  const measure = async (keepImg) => {
    const d = window.__rf3dFold, pr = d.portal;
    await ready();
    setBg(1, 0, 1);
    const Pm = await grab();
    const st = { ...pr.stats };
    const dc = v.instr.drawCallsCounter.current;
    setBg(0, 1, 0);
    const Pg = await grab();
    // R: области проёмов залиты голубым, комнаты за проёмами не рисуются (подмена методов только в QA)
    const fill0 = pr.fillRegion, draw0 = pr.drawRoom;
    pr.fillRegion = function (n) {
      const c = sc.clearColor;
      sc.clearColor = new C4(0, 1, 1, 1);
      fill0.call(this, n);
      sc.clearColor = c;
    };
    pr.drawRoom = function (p, ref, clip, planes) {
      if (ref === 0) draw0.call(this, p, ref, clip, planes);
    };
    setBg(1, 0, 1);
    let R;
    try {
      R = await grab();
    } finally {
      delete pr.fillRegion;
      delete pr.drawRoom;
    }
    sc.clearColor = bg0.clone();
    const W = eng.getRenderWidth(), H = eng.getRenderHeight();
    let strong = 0, any = 0, door = 0, crack = 0, crackAny = 0;
    const mask = new Uint8Array(W * H);
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      const inDoor = R[i] < 60 && R[i + 1] > 195 && R[i + 2] > 195; // голубой — область проёма
      const outside = R[i] > 195 && R[i + 1] < 60 && R[i + 2] > 195; // пурпурный — вне всего (трещина своей комнаты)
      if (inDoor) door++;
      const dp = Math.max(Math.abs(Pm[i] - Pg[i]), Math.abs(Pm[i + 1] - Pg[i + 1]), Math.abs(Pm[i + 2] - Pg[i + 2]));
      if (dp <= 8) continue;
      if (outside) {
        crackAny++;
        if (dp > 127) crack++;
        continue;
      }
      any++;
      if (dp > 127) (strong++, (mask[p] = 1));
    }
    const res = { strong, any, door, crack, crackAny, rooms: st.rooms, unique: st.unique, portals: st.portals, levels: st.levels, far: st.far, capped: st.capped, dc };
    if (keepImg || strong > 0) {
      // обычный кадр (фон как в приложении) и маска дыр
      await ready();
      const N = await grab();
      res.img = png(N, W, H);
      if (strong > 0) res.holes = png(N, W, H, mask);
    }
    return res;
  };
  /** Поставить камеру: точка плана (x, y), высота глаза над полом z, рысканье yaw, наклон pitch. */
  const place = (x, y, z, yaw, pitch = 0.04) => {
    cam.position.set(x, z + 1.6, -y);
    cam.rotation.set(pitch, yaw, 0);
    cam.cameraDirection.setAll(0);
    cam.cameraRotation.setAll(0);
  };
  window.__qan = {
    v, frame, ready, measure, place,
    /** идти к точке плана (x, y) — до 300 кадров; true — дошли */
    async walkTo(x, y, speed = 0.06) {
      cam.checkCollisions = true;
      cam.applyGravity = true;
      let last = null, still = 0;
      for (let k = 0; k < 300; k++) {
        const dx = x - cam.position.x, dy = -y - cam.position.z;
        const d = Math.hypot(dx, dy);
        if (d < 0.08) return true;
        const s = Math.min(speed, d);
        cam.cameraDirection.set((dx / d) * s, 0, (dy / d) * s);
        cam.rotation.y = Math.atan2(dx, dy);
        cam.rotation.x = 0.05;
        await frame();
        const p = [cam.position.x, cam.position.z];
        if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.002) {
          if (++still > 40) return false;
        } else still = 0;
        last = p;
      }
      return false;
    },
  };
});

// ── 1) ходьба и виды ──
const visited = [];
const crossings = [];
const views = [];
const perfRooms = [];
const keep = []; // снимки
let stuck = 0;
for (let step = 0; crossings.length < want && step < want * 3; step++) {
  const st = await page.evaluate(() => {
    const d = window.__rf3dFold;
    const cur = d.portal.current;
    const piece = d.pieces.get(cur);
    return { cur, portals: piece.portals.map((q) => ({ to: q.to, axis: q.axis, at: q.at, dir: q.dir, lo: q.lo, hi: q.hi })), floor: piece.floor };
  });
  if (!visited.includes(st.cur)) visited.push(st.cur);
  const prev = crossings.length ? crossings[crossings.length - 1].from : null;
  const cand = st.portals.filter((q) => !visited.includes(q.to));
  const q = cand[0] ?? st.portals.find((x) => x.to !== prev) ?? st.portals[0];
  if (!q) break;
  const mid = (q.lo + q.hi) / 2;
  const P = (n) => (q.axis === 'x' ? [q.at + q.dir * n, mid] : [mid, q.at + q.dir * n]);
  const onFloor = (pt) => st.floor.some((r) => pt[0] > r.x0 + 0.32 && pt[0] < r.x1 - 0.32 && pt[1] > r.y0 + 0.32 && pt[1] < r.y1 - 0.32);
  let approach = null;
  for (const n of [-0.8, -0.6, -0.45, -0.35]) if (onFloor(P(n))) { approach = P(n); break; }
  if (!approach) approach = P(-0.35);
  const r = await page.evaluate(async ({ approach, through, after, to }) => {
    const { walkTo, frame, v } = window.__qan;
    const d = window.__rf3dFold;
    const from = d.portal.current;
    d.autoCross = true;
    d.portal.autoTrack = true;
    if (!(await walkTo(approach[0], approach[1]))) {
      v.fps.position.set(approach[0], v.fps.position.y, -approach[1]);
      v.fps.cameraDirection.setAll(0);
      for (let k = 0; k < 5; k++) await frame();
    }
    await walkTo(through[0], through[1]);
    await walkTo(after[0], after[1]);
    for (let k = 0; k < 4; k++) await frame();
    return { from, now: d.portal.current, to, yaw: v.fps.rotation.y };
  }, { approach, through: P(0.3), after: P(0.9), to: q.to });
  if (r.now !== r.to) {
    stuck++;
    console.log('не прошли', r.from, '→', r.to, 'сейчас', r.now);
    if (stuck > 8) break;
    await page.evaluate((to) => window.__rf3dFold.goTo(to), q.to);
    await wait(400);
    continue;
  }
  crossings.push({ from: r.from, to: r.to });
  await wait(250); // раскрытие мира (ensureVisible) — в задаче после кадра перехода
  // виды: 6 из середины комнаты по кругу + 2 от входа вперёд
  const rv = await page.evaluate(async ({ yaw0, n }) => {
    const { measure, place, v } = window.__qan;
    const d = window.__rf3dFold;
    d.autoCross = false;
    d.portal.autoTrack = false;
    const cam = v.fps;
    cam.applyGravity = false;
    cam.checkCollisions = false;
    const id = d.portal.current;
    const piece = d.pieces.get(id);
    const z = piece.model.floors.find((f) => f.inst === id)?.z ?? 0;
    const entry = [cam.position.x, -cam.position.z];
    // точка у середины комнаты: свободная от мебели (как спавн)
    v.spawnIn(piece.model, id);
    const c = [cam.position.x, -cam.position.z];
    const out = [];
    for (let k = 0; k < 6; k++) {
      place(c[0], c[1], z, yaw0 + (k * Math.PI) / 3);
      out.push({ room: id, at: 'середина', x: c[0], y: c[1], z, yaw: +(yaw0 + (k * Math.PI) / 3).toFixed(3), ...(await measure(false)) });
    }
    for (const dy of [0, 0.45]) {
      place(entry[0], entry[1], z, yaw0 + dy);
      out.push({ room: id, at: 'вход', x: entry[0], y: entry[1], z, yaw: +(yaw0 + dy).toFixed(3), ...(await measure(false)) });
    }
    // вернуть игрока ко входу (дальше ходьба оттуда)
    place(entry[0], entry[1], z, yaw0);
    cam.applyGravity = true;
    cam.checkCollisions = true;
    d.autoCross = true;
    d.portal.autoTrack = true;
    return { views: out, center: c, z };
  }, { yaw0: r.yaw, n: crossings.length });
  for (const x of rv.views) views.push({ n: crossings.length, ...x });
  if (perfRooms.length < 10 && crossings.length % 2 === 0) perfRooms.push({ room: r.to, c: rv.center, z: rv.z });
  const bad = rv.views.filter((x) => x.strong > 0);
  const cr = rv.views.filter((x) => x.crack > 0);
  console.log(`#${crossings.length} ${r.from}→${r.to}: видов ${rv.views.length}, с дырами ${bad.length}${bad.length ? ' (' + bad.map((x) => `${x.at} ${x.yaw}: ${x.strong} px из ${x.door}`).join('; ') + ')' : ''}, трещины своей комнаты в ${cr.length} (до ${Math.max(0, ...cr.map((x) => x.crack))} px), комнат в кадре до ${Math.max(...rv.views.map((x) => x.rooms))}, проёмов до ${Math.max(...rv.views.map((x) => x.portals))}`);
}

// снимки дыр (если были) и самых глубоких видов
const deep = [...views].sort((a, b) => b.rooms - a.rooms).slice(0, 4);
const shotViews = [...deep, ...views.filter((x) => x.strong > 0).slice(0, 4)];

// ── 2) производительность: без тумана / с туманом — на каждом виде попеременно (без перекоса прогрева) ──
const perf = {};
const sightM = await page.evaluate(() => window.__rfWalk.world.settings.sightM);
// виды: середины комнат × 4 стороны и 10 самых «глубоких» видов обхода
const perfViews = [];
for (const r of perfRooms) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) perfViews.push({ room: r.room, x: r.c[0], y: r.c[1], z: r.z, yaw, deep: false });
for (const x of [...views].sort((a, b) => b.rooms - a.rooms).slice(0, 10)) perfViews.push({ room: x.room, x: x.x, y: x.y, z: x.z, yaw: x.yaw, deep: true });
const rows = await page.evaluate(async ({ list, sightM }) => {
  const { v, ready, place, frame } = window.__qan;
  const d = window.__rf3dFold;
  d.autoCross = false;
  d.portal.autoTrack = false;
  const cam = v.fps;
  cam.applyGravity = false;
  cam.checkCollisions = false;
  const run = async () => {
    for (let k = 0; k < 10; k++) await frame();
    let dc = 0, cpu = 0, rr = 0, pp = 0;
    const t0 = performance.now();
    for (let k = 0; k < 30; k++) {
      await frame();
      dc += v.instr.drawCallsCounter.current;
      cpu += d.portal.stats.ms;
      rr += d.portal.stats.rooms;
      pp += d.portal.stats.portals;
    }
    return { ms: (performance.now() - t0) / 30, dc: dc / 30, cpu: cpu / 30, rooms: rr / 30, portals: pp / 30 };
  };
  const rows = [];
  for (const x of list) {
    if (d.portal.current !== x.room) await d.crossTo(x.room);
    place(x.x, x.y, x.z, x.yaw);
    await ready();
    const row = { deep: x.deep };
    // порядок чередуется от вида к виду
    for (const fog of rows.length % 2 ? [true, false] : [false, true]) {
      v.setFog(fog ? sightM : 0);
      row[fog ? 'fog' : 'nofog'] = await run();
    }
    v.setFog(0);
    rows.push(row);
  }
  return rows;
}, { list: perfViews, sightM });
const agg = (sel, key) => {
  const rs = rows.filter(sel).map((r) => r[key]);
  const avg = (f) => rs.reduce((s, r) => s + f(r), 0) / rs.length;
  const max = (f) => Math.max(...rs.map(f));
  return {
    views: rs.length,
    msFrame: +avg((r) => r.ms).toFixed(1),
    drawCalls: +avg((r) => r.dc).toFixed(1),
    drawCallsMax: +max((r) => r.dc).toFixed(0),
    cpuPortalMs: +avg((r) => r.cpu).toFixed(2),
    rooms: +avg((r) => r.rooms).toFixed(1),
    roomsMax: +max((r) => r.rooms).toFixed(0),
    portals: +avg((r) => r.portals).toFixed(1),
    portalsMax: +max((r) => r.portals).toFixed(0),
  };
};
for (const [name, sel] of [['середины', (r) => !r.deep], ['глубокие', (r) => r.deep]]) {
  perf[name] = { nofog: agg(sel, 'nofog'), fog: agg(sel, 'fog') };
  console.log(`${name}: без тумана ${JSON.stringify(perf[name].nofog)}
  с туманом (${sightM} м) ${JSON.stringify(perf[name].fog)}`);
}

// ── 3) снимки: самые глубокие виды без тумана и с туманом, виды с дырами ──
for (const [k, x] of shotViews.entries()) {
  const imgs = await page.evaluate(async ({ x, sightM }) => {
    const { v, place, measure } = window.__qan;
    const d = window.__rf3dFold;
    d.autoCross = false;
    d.portal.autoTrack = false;
    if (d.portal.current !== x.room) await d.crossTo(x.room);
    const out = {};
    v.fps.applyGravity = false;
    v.fps.checkCollisions = false;
    place(x.x, x.y, x.z, x.yaw);
    const a = await measure(true);
    out.nofog = a.img;
    if (a.holes) out.holes = a.holes;
    out.stats = { rooms: a.rooms, portals: a.portals, levels: a.levels, far: a.far, strong: a.strong };
    v.setFog(sightM);
    const b = await measure(true);
    out.fog = b.img;
    v.setFog(0);
    return out;
  }, { x, sightM });
  const base = `nofog-${seed}-${k}-${x.room}-y${x.yaw}`;
  for (const key of ['nofog', 'fog', 'holes']) if (imgs[key]) writeFileSync(out + `${base}-${key}.png`, Buffer.from(imgs[key].split(',')[1], 'base64'));
  console.log('снимок', base, JSON.stringify(imgs.stats));
}

// ── сводка ──
const n = views.length;
const withHoles = views.filter((x) => x.strong > 0);
const doorPx = views.reduce((s, x) => s + x.door, 0);
const holePx = views.reduce((s, x) => s + x.strong, 0);
const stats = await page.evaluate(() => ({ rooms: window.__rfWalk.rx.instances.length, mem: window.__rf3dFold.pieces.memory }));
const summary = {
  seed,
  crossings: crossings.length,
  stuck,
  rooms: stats.rooms,
  pieces: stats.mem,
  views: n,
  viewsWithDoors: views.filter((x) => x.door > 0).length,
  viewsClean: n - withHoles.length,
  viewsWithHoles: withHoles.length,
  holePxTotal: holePx,
  holeShareOfDoorArea: doorPx ? +(holePx / doorPx).toExponential(2) : 0,
  holePxMax: Math.max(0, ...views.map((x) => x.strong)),
  viewsWithCracks: views.filter((x) => x.crack > 0).length,
  crackPxMax: Math.max(0, ...views.map((x) => x.crack)),
  aaPxMax: Math.max(0, ...views.map((x) => x.any)),
  roomsInFrame: { avg: +(views.reduce((s, x) => s + x.rooms, 0) / n).toFixed(1), max: Math.max(...views.map((x) => x.rooms)) },
  portalsInFrame: { avg: +(views.reduce((s, x) => s + x.portals, 0) / n).toFixed(1), max: Math.max(...views.map((x) => x.portals)) },
  levelsMax: Math.max(...views.map((x) => x.levels)),
  farViews: views.filter((x) => x.far > 0).length,
  cappedViews: views.filter((x) => x.capped > 0).length,
  perf,
  minutes: +((Date.now() - t00) / 60000).toFixed(1),
  errors,
};
writeFileSync(out + `qa-3d-nofog-${seed}.json`, JSON.stringify({ summary, views: views.map(({ img, holes, ...x }) => x) }, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
