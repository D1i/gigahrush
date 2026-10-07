// QA «Ржавого лифта» в «Прогулке» (бесконечный мир): playwright + системный Chrome, свой vite (порт 5217).
//  (а) найти в мире экземпляр лифта (BFS от старта), войти в него пешком через дверь соседней комнаты;
//  (б) в кабину, «вверх» до этажа 1, выйти в конец узкого коридора → world.ascend: комната этажом выше, игрок у
//      стены, через которую пришёл, вспышка «этаж +1 · прямо»;
//  (в) шагнуть к этой стене → снова лифт, у этажа 1, в узком коридоре;
//  (г) до этажа логова и в его коридор → «E — открыть» → логово: темно, табличка, красный свет; назад к стене →
//      лифт.
// Скриншоты — tools/qa/liftwalk-*.png. node tools/qa-lift-walk.mjs [--keep-server]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5217;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const keep = process.argv.includes('--keep-server');
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
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
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

/** В сцене лифта: дойти до точки (мир сцены), шагами механики. */
const LIFT_WALK = () => {
  window.__lw = (x, z, maxSec = 12) => {
    const s = window.__rfLift;
    for (let k = 0; k < maxSec * 60 && !s.hud().dead; k++) {
      const dx = x - s.pos.x, dz = z - s.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.08) return true;
      s.camera.rotation.y = Math.atan2(dx, dz);
      s.simulate(1 / 60, { f: Math.min(1, d / 0.2), s: 0, run: false });
      s.sync();
    }
    return false;
  };
  /** доехать до этажа f (кнопки поста), без досок */
  window.__lride = (f) => {
    const s = window.__rfLift;
    for (let g = 0; g < 10 && s.state.floor !== f; g++) {
      s.press(s.state.floor < f ? 'up' : 'down');
      for (let k = 0; k < 60 * 30 && s.state.phase !== 'idle'; k++) {
        s.simulate(1 / 60, { f: 0, s: 0, run: false });
        s.sync();
      }
    }
    return s.qaState();
  };
};

/** Камерой болванки — к точке (Babylon x, z), кадрами; стоп, если открылась сцена локации. */
const camWalk = (page, x, z, frames = 300) =>
  page.evaluate(
    async ({ x, z, frames }) => {
      const v = window.__rf3d;
      const cam = v.fps;
      const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      for (let k = 0; k < frames && !v.hasOverlay; k++) {
        const dx = x - cam.position.x, dz = z - cam.position.z, d = Math.hypot(dx, dz);
        if (d < 0.06) break;
        cam.cameraDirection.set((dx / d) * Math.min(0.05, d), 0, (dz / d) * Math.min(0.05, d));
        cam.rotation.y = Math.atan2(dx, dz);
        await frame();
      }
      return { overlay: v.hasOverlay, pos: [cam.position.x, cam.position.y, cam.position.z] };
    },
    { x, z, frames },
  );

const waitLift = (page) => page.waitForFunction(() => window.__rfLift?.ready, null, { timeout: 180000 });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
  await go(page, BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-lift-walk', deadEndChance: 0.1, branching: 1, aheadDoors: 2, on: true }));
  });
  await page.reload({ timeout: 180000 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.__rfLiftSpec = { boardChance: 0 };
  });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
  await page.waitForTimeout(1500);

  // ═════════ (а) лифт в мире ═════════
  const found = await page.evaluate(() => {
    const w = window.__rfWalk.world;
    const seen = new Set();
    const queue = [w.startId];
    let loc = null;
    for (let k = 0; k < 1500 && queue.length && !loc; k++) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      if (w.locationOf(id)?.kind === 'lift') {
        loc = id;
        break;
      }
      w.expand(id);
      for (const l of w.run().links) {
        if (l.kind === 'descent' || l.kind === 'lift') continue;
        if (l.a.inst === id && !seen.has(l.b.inst)) queue.push(l.b.inst);
        if (l.b.inst === id && !seen.has(l.a.inst)) queue.push(l.a.inst);
      }
    }
    if (!loc) return null;
    const run = w.run();
    const l = run.links.find((x) => x.kind !== 'descent' && x.kind !== 'lift' && (x.a.inst === loc || x.b.inst === loc));
    return { loc, from: l ? (l.a.inst === loc ? l.b.inst : l.a.inst) : null, rooms: run.instances.length, roll: w.locationOf(loc).roll };
  });
  ok('(а) в мире есть «Ржавый лифт»', !!found?.from, found ? `${found.loc} (через ${found.from}), комнат ${found.rooms}, розыгрыш ${JSON.stringify(found.roll)}` : 'не нашли');
  if (!found?.from) throw new Error('нет лифта');
  await page.waitForFunction((id) => window.__rfWalk.rx.instances.some((i) => i.id === id), found.loc, { timeout: 30000 });
  await page.evaluate((from) => window.__rf3dFold.goTo(from), found.from);
  await page.waitForTimeout(1500);
  const door = await page.evaluate(({ from, loc }) => {
    const piece = window.__rf3dFold.pieces.get(from);
    const q = piece.portals.find((p) => p.to === loc);
    return q ? { cx: q.center.x, cz: q.center.z, ux: q.u.x, uz: q.u.z } : null;
  }, found);
  ok('(а) дверь соседней комнаты в шахту', !!door);
  await page.evaluate((d) => {
    const c = window.__rf3d.fps;
    c.position.set(d.cx - d.ux * 1.2, c.position.y, d.cz - d.uz * 1.2);
  }, door);
  await page.waitForTimeout(300);
  const walked = await camWalk(page, door.cx + door.ux * 1.0, door.cz + door.uz * 1.0, 400);
  await waitLift(page).catch(() => {});
  const inLift = await page.evaluate(() => ({ ready: !!window.__rfLift?.ready, st: window.__rfLift?.qaState() }));
  ok('(а) шагнул в дверь — сцена лифта, этаж 0, вход', inLift.ready && inLift.st.floor === 0 && !inLift.st.inCage, JSON.stringify({ overlay: walked.overlay, variant: inLift.st?.variant, floors: inLift.st?.floors, lair: inLift.st?.lair }));
  await page.evaluate(LIFT_WALK);
  await page.evaluate(() => window.__rfLift.qaStart());

  // ═════════ (б) этаж 1, выход прямо ═════════
  await page.evaluate(() => window.__lw(0, 0));
  const st1 = await page.evaluate(() => window.__lride(1));
  const L = st1.lair;
  // если логово — прямо на этаже 1, выходим направо
  const side1 = L && L.floor === 1 && L.side === 'straight' ? 'right' : 'straight';
  await page.evaluate((sd) => (sd === 'straight' ? window.__lw(0, 6, 15) : window.__lw(-6.5, 0, 15)), side1);
  await page.waitForFunction(() => !window.__rfLift && !window.__rf3d.hasOverlay, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const d = window.__rf3dFold, w = window.__rfWalk.world;
    const room = d.portal?.current ?? d.current.center;
    const inst = w.run().instances.find((i) => i.id === room);
    const link = w.run().links.find((l) => l.kind === 'lift' && l.b.inst === room);
    return { room, floor: inst?.floor, roomId: inst?.roomId, link, cam: window.__rf3d.fps.position.asArray().map((x) => +x.toFixed(2)), flash: document.querySelector('.v3-flash')?.textContent ?? null };
  });
  ok('(б) вышел из лифта — комната этажом выше у стены прихода', !!after.link && after.floor === 1 && after.link.floors === 1 && after.link.side === side1, JSON.stringify(after));
  const face = await page.evaluate((a) => {
    const d = window.__rf3dFold.deadEndAt(a.room, a.link.b.connector);
    const c = window.__rf3d.fps;
    const f = { x: Math.sin(c.rotation.y), z: Math.cos(c.rotation.y) };
    return { dist: +Math.hypot(c.position.x - d.center.x, c.position.z - d.center.z).toFixed(2), dot: +(f.x * d.u.x + f.z * d.u.z).toFixed(2), depth: +d.depth.toFixed(2) };
  }, after);
  ok('(б) стоит в 0.8 м от стены прихода лицом в комнату', Math.abs(face.dist - 0.8) < 0.15 && face.dot > 0.9, JSON.stringify(face));
  await page.screenshot({ path: out + 'liftwalk-1-exit-room.png' });

  // ═════════ (в) назад к стене → лифт ═════════
  const de = await page.evaluate((a) => {
    const x = window.__rf3dFold.deadEndAt(a.room, a.link.b.connector);
    return x ? { x: x.center.x, z: x.center.z } : null;
  }, after);
  await page.waitForTimeout(1600); // liftCool
  await camWalk(page, de.x, de.z, 400);
  await waitLift(page).catch(() => {});
  const back = await page.evaluate(() => window.__rfLift?.qaState());
  ok('(в) шагнул к стене — снова лифт у этажа 1, в коридоре', !!back && back.floor === 1 && back.phase === 'idle' && !back.inCage, JSON.stringify(back && { floor: back.floor, pos: back.pos }));

  // ═════════ (г) логово ═════════
  if (back && L) {
    await page.evaluate(LIFT_WALK);
    await page.evaluate(() => window.__rfLift.qaStart());
    await page.evaluate(() => window.__lw(0, 0));
    await page.evaluate((f) => window.__lride(f), L.floor);
    const near = await page.evaluate((side) => (side === 'right' ? window.__lw(-5.6, 0, 15) : window.__lw(0, 5.0, 15)), L.side);
    const prompt = await page.evaluate(() => window.__rfLift.hud().prompt);
    ok('(г) у двери логова — «E — открыть»', near && prompt === 'E — открыть дверь', prompt ?? '—');
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
      const s = window.__rfLift;
      s.simulate(1 / 60, { f: 0, s: 0, run: false });
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
    });
    await page.waitForFunction(() => !window.__rfLift && !window.__rf3d.hasOverlay, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const lair = await page.evaluate(() => {
      const d = window.__rf3dFold, w = window.__rfWalk.world;
      const room = d.portal?.current ?? d.current.center;
      const sc = window.__rf3d.scene;
      return { kind: w.locationOf(room)?.kind ?? null, sign: !!sc.getMeshByName('lair:sign'), red: !!sc.getLightByName('lair:red'), hemi: +(sc.getLightByName('hemi')?.intensity ?? -1).toFixed(3) };
    });
    ok('(г) логово: тёмная комната, табличка, красный свет', lair.kind === 'lair' && lair.sign && lair.red && lair.hemi < 0.2, JSON.stringify(lair));
    // посмотреть на табличку: развернуться от стены прихода
    await page.waitForTimeout(500);
    await page.screenshot({ path: out + 'liftwalk-2-lair.png' });
    const a2 = await page.evaluate(() => {
      const d = window.__rf3dFold, w = window.__rfWalk.world;
      const room = d.portal?.current ?? d.current.center;
      const link = w.run().links.find((l) => l.kind === 'lift' && l.b.inst === room);
      const x = d.deadEndAt(room, link.b.connector);
      return { x: x.center.x, z: x.center.z };
    });
    await page.waitForTimeout(1600);
    await camWalk(page, a2.x, a2.z, 400);
    await waitLift(page).catch(() => {});
    const back2 = await page.evaluate(() => window.__rfLift?.qaState());
    const lightBack = await page.evaluate(() => +(window.__rf3d.scene.getLightByName('hemi')?.intensity ?? -1).toFixed(3));
    ok('(г) из логова назад к стене — лифт, свет просмотрщика вернулся', !!back2 && back2.floor === L.floor && lightBack > 0.5, JSON.stringify({ floor: back2?.floor, hemi: lightBack }));
  }
} catch (e) {
  console.error(e);
  ok('скрипт не упал', false, String(e?.message ?? e));
}
ok('нет ошибок в консоли', errors.length === 0, errors.slice(0, 6).join(' || '));
await browser.close();
stopServer();
const bad = results.filter((r) => !r.ok);
console.log(`\nИтого: ${results.length - bad.length}/${results.length}`);
process.exit(bad.length ? 1 : 0);
