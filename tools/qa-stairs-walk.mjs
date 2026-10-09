// QA лестниц с перепадом высоты в «Прогулке» (Room.stair, src/model/stairs.ts, src/blockout/stairs.ts):
//  • в проект добавляется тестовый зал «площадка — марш — площадка» (2.4 × 5.5 м, этаж 2.7 м) и ставится стартом;
//  • игрок с нижней площадки идёт вверх по маршу: глаз поднимается на ≈ этаж, без провала сквозь пандус;
//  • проходит в комнату за верхней дверью: текущая комната — она, высота непрерывна, коллизии у неё;
//  • смотрит назад — марш вниз виден; спускается обратно — глаз снова внизу;
//  • перезагрузка страницы: мир из сохранения — комната за верхом на той же высоте.
//
//   node tools/qa-stairs-walk.mjs [--keep-server] [--narrow | --steep]   (скриншоты — tools/qa/stairs-*.png)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5246;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const keep = process.argv.includes('--keep-server');
const narrow = process.argv.includes('--narrow');
// крутой марш как у зала общаги: площадки по 1.25 м, марш 3.0 м на этаж (18 ступеней по 0.167 — ≈ 42°)
const steep = process.argv.includes('--steep');
const server = spawn(`npx vite --port ${PORT} --strictPort`, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
const stopServer = () => {
  if (keep) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true });
    else server.kill('SIGTERM');
  } catch {}
};
for (let k = 0; k < 120 && !/ready in|Local:/.test(serverLog); k++) await new Promise((r) => setTimeout(r, 500));
const BASE = `http://localhost:${PORT}/`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = [];
const ok = (name, cond, info = '') => {
  results.push({ name, ok: !!cond, info });
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};
const errors = [];
const go = async (page, url) => {
  for (let k = 0; ; k++) {
    try {
      await page.goto(url, { timeout: 180000 });
      return;
    } catch (e) {
      if (k >= 4) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
};
const HALL = narrow ? 'qa_stair_narrow' : steep ? 'qa_stair_steep' : 'qa_stair_hall';
const f2 = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));

/** Камерой — к точке (Babylon x, z) шагами по 5 см за кадр (≈ 3 м/с), лицом по ходу; минимум/максимум высоты глаза. */
const camWalk = (page, x, z, frames = 600) =>
  page.evaluate(
    async ({ x, z, frames }) => {
      const v = window.__rf3d;
      const cam = v.fps;
      const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      let minY = Infinity, maxY = -Infinity, flight = 0;
      for (let k = 0; k < frames && !v.hasOverlay; k++) {
        const dx = x - cam.position.x, dz = z - cam.position.z, d = Math.hypot(dx, dz);
        if (d < 0.06) break;
        cam.cameraDirection.set((dx / d) * Math.min(0.05, d), 0, (dz / d) * Math.min(0.05, d));
        cam.rotation.y = Math.atan2(dx, dz);
        await frame();
        minY = Math.min(minY, cam.position.y);
        maxY = Math.max(maxY, cam.position.y);
        if (window.__rf3dFold.portal?.stairs?.onFlight) flight++;
      }
      for (let k = 0; k < 20; k++) await frame();
      return { pos: [cam.position.x, cam.position.y, cam.position.z], minY, maxY, flight };
    },
    { x, z, frames },
  );

const state = (page) =>
  page.evaluate(() => {
    const d = window.__rf3dFold, c = window.__rf3d.fps;
    return { room: d.portal?.current ?? null, y: c.position.y, colliding: d.portal?.colliding ?? [], rooms: d.portal?.stats.rooms ?? 0, unique: d.portal?.stats.unique ?? 0 };
  });

const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
// загрузка ассетов, прерванная перезагрузкой страницы, — не ошибка лестниц
const noise = (t) => /Scene has been disposed/.test(t);
page.on('pageerror', (e) => noise(String(e)) || errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !noise(m.text())) errors.push(m.text());
});
try {
  await go(page, BASE);
  // мир: без квартир (рост от старта), старт — тестовый зал; сиды перебираем, пока за обеими дверьми есть комнаты
  let info = null;
  for (const seed of ['qa-stairs-a', 'qa-stairs-b', 'qa-stairs-c', 'qa-stairs-d']) {
    await page.evaluate(({ seed }) => {
      localStorage.clear();
      localStorage.setItem('room-forge/walk', JSON.stringify({ seed, deadEndChance: 0, branching: 1, aheadDoors: 2, clusters: false, biome: null, on: true }));
    }, { seed });
    await page.reload({ timeout: 180000 });
    await page.waitForTimeout(800);
    await page.evaluate(async ({ id, narrow, steep }) => {
      const { mutate } = await import('/src/model/store.ts');
      const { room } = await import('/src/data/roomBuilder.ts');
      const { straightStair } = await import('/src/model/stairs.ts');
      const r = room(id, 'QA: лестничный зал', { tags: ['лестница'], note: 'QA', gen: { weight: 0.5, min: 0, max: 99 }, elite: [] })
        .rect(0, 0, 2.4, 5.5).open('N', 0.55, 'corridor', 'Верх').open('S', 0.55, 'corridor', 'Низ').build();
      r.stair = straightStair({ w: 2.4, l: 5.5, up: 'N', ...(narrow ? { flightW: 1.2 } : {}), ...(steep ? { landing: 1.25, top: 1.25 } : {}) });
      mutate((p) => {
        p.rooms = p.rooms.filter((x) => x.id !== id);
        p.rooms.push(r);
        p.generator.startRoomId = id;
      });
    }, { id: HALL, narrow, steep });
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
    await page.waitForTimeout(1500);
    info = await page.evaluate(() => {
      const s = window.__rfWalk, d = window.__rf3dFold;
      const start = s.world.startId;
      const hall = s.rx.instances.find((i) => i.id === start);
      const up = hall.connectors.find((k) => k.name === 'Верх')?.linkedTo?.inst ?? null;
      const down = hall.connectors.find((k) => k.name === 'Низ')?.linkedTo?.inst ?? null;
      const piece = d.pieces.get(start);
      const f = piece.model.stairs?.[0]?.flights?.[0];
      const portalUp = piece.portals.find((q) => q.to === up);
      return {
        seed: s.key, start, roomId: hall.roomId, up, down, upZ: s.rx.instances.find((i) => i.id === up)?.z ?? 0,
        flight: f ? { ...f.rect, steps: f.steps } : null,
        portalUp: portalUp ? { x: portalUp.center.x, y: portalUp.center.y, z: portalUp.center.z, ux: portalUp.u.x, uz: portalUp.u.z } : null,
      };
    });
    if (info.up && info.flight) break;
    await page.getByRole('button', { name: '3D', exact: true }).click().catch(() => {});
  }
  console.log('мир:', JSON.stringify(info));
  ok('старт — тестовый зал, за верхней дверью комната', info?.roomId === HALL && info.up, `${info?.start} ↑${info?.up} ↓${info?.down ?? 'тупик'}`);
  ok('комната за верхней дверью — на этаж выше', Math.abs(info.upZ - 2.7) < 1e-6, `z = ${info.upZ}`);
  const F = info.flight;
  const cx = narrow ? F.x0 + 0.6 : (F.x0 + F.x1) / 2;

  // 0) «На старт» (goTo / spawnIn): точка спавна зала — середина пола, это марш: игрок стоит на ступенях, не внутри
  const s00 = await page.evaluate(async () => {
    const d = window.__rf3dFold, c = window.__rf3d.fps;
    d.toStart();
    for (let k = 0; k < 30; k++) await new Promise((r) => requestAnimationFrame(() => r()));
    const g = d.pieces.get(d.portal.current).model.stairs;
    const { stairFloorAt } = await import('/src/blockout/stairs.ts');
    const f = stairFloorAt(g, c.position.x, -c.position.z);
    return { y: c.position.y, floor: f ? f.z : 0, flight: f?.flight ?? false };
  });
  ok('спавн в зале: на марше над ступенями', s00.y - 1.6 >= s00.floor - 0.02 && s00.y - 1.6 < s00.floor + 0.2, `глаз ${f2(s00.y)}, пол лестницы ${f2(s00.floor)}${s00.flight ? ' (марш)' : ''}`);

  // 1) нижняя площадка, лицом к маршу (на север: план −y = Babylon +z)
  await page.evaluate(({ x, y }) => {
    const c = window.__rf3d.fps;
    window.__rf3dFold.goTo(window.__rfWalk.world.startId);
    c.position.set(x, 1.65, -y);
    c.rotation.set(0.12, 0, 0);
    c.cameraDirection.setAll(0);
  }, { x: cx, y: F.y1 + 0.6 });
  await page.waitForTimeout(1200);
  const s0 = await state(page);
  ok('внизу: глаз на 1.6 м над полом зала', Math.abs(s0.y - 1.6) < 0.08, `y = ${f2(s0.y)}`);
  await page.screenshot({ path: out + 'stairs-1-bottom.png' });

  // 2) вверх по маршу до верхней площадки
  const w1 = await camWalk(page, cx, -(F.y0 - 0.45));
  const s1 = await state(page);
  ok('поднялся по маршу на этаж', Math.abs(s1.y - s0.y - 2.7) < 0.12, `y ${f2(s0.y)} → ${f2(s1.y)} (min ${f2(w1.minY)}), кадров на марше ${w1.flight}`);
  ok('по пути не проваливался', w1.minY > s0.y - 0.1, `min y = ${f2(w1.minY)}`);
  ok('дошёл до верхней площадки', Math.abs(-w1.pos[2] - (F.y0 - 0.45)) < 0.15, `план y = ${f2(-w1.pos[2])}`);
  await page.evaluate(() => {
    const c = window.__rf3d.fps;
    c.rotation.set(0.35, Math.PI, 0);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + 'stairs-2-top-look-down.png' });

  // 3) в комнату за верхней дверью: 1.2 м за проём
  const P = info.portalUp;
  const w2 = await camWalk(page, P.x + P.ux * 1.2, P.z + P.uz * 1.2);
  const s2 = await state(page);
  ok('за верхней дверью — комната над залом', s2.room === info.up, `текущая ${s2.room}`);
  ok('высота непрерывна (глаз над её полом)', Math.abs(s2.y - (info.upZ + 1.6)) < 0.08 && w2.minY > info.upZ + 1.4, `y = ${f2(s2.y)}, min ${f2(w2.minY)}`);
  ok('коллизии у комнаты над залом', s2.colliding.includes(info.up), s2.colliding.join(','));
  await page.evaluate(() => {
    const c = window.__rf3d.fps;
    c.rotation.set(0.25, Math.PI, 0);
  });
  await page.waitForTimeout(700);
  const s2b = await state(page);
  ok('назад сквозь проём виден зал (портал открыт)', s2b.unique >= 2, `комнат в кадре ${s2b.unique}`);
  await page.screenshot({ path: out + 'stairs-3-above-look-back.png' });

  // 4) обратно вниз
  await camWalk(page, P.x - P.ux * 0.6, P.z - P.uz * 0.6);
  const w4 = await camWalk(page, cx, -(F.y1 + 0.6));
  const s4 = await state(page);
  ok('спустился обратно', Math.abs(s4.y - s0.y) < 0.08 && s4.room === info.start, `y = ${f2(s4.y)}, комната ${s4.room}, кадров на марше ${w4.flight}`);
  await page.evaluate(() => window.__rf3d.fps.rotation.set(-0.15, Math.PI, 0));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__rf3d.fps.rotation.set(-0.05, 0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + 'stairs-4-bottom-look-up.png' });

  // 5) перезагрузка — мир из сохранения
  await page.waitForTimeout(1200);
  await page.reload({ timeout: 180000 });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
  await page.waitForTimeout(1200);
  const z5 = await page.evaluate((up) => window.__rfWalk.world.run().instances.find((i) => i.id === up)?.z ?? 0, info.up);
  ok('после перезагрузки высота комнаты за верхом та же', Math.abs(z5 - 2.7) < 1e-6, `z = ${z5}`);
} catch (e) {
  ok('без исключений', false, String(e?.stack ?? e));
} finally {
  ok('без ошибок страницы', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  stopServer();
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad ? `\n${bad} провал(ов)` : '\nвсё OK');
  process.exit(bad ? 1 : 0);
}
