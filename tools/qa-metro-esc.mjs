// QA эскалаторов метро в браузере (docs/LOCATIONS.md §18 «Метро: эскалаторы»):
//  A  старт в метро: режим метро включён, свет холодный, туман метро;
//  B  эскалаторный тоннель: дорожки, направления; лента везёт вверх / вниз (сдвиг по наклону ≈ 0.75 м/с);
//  C  срыв под игроком высоко на дорожке: рывок → лента бежит вниз → обрыв, падение, затемнение, «Эскалатор сорвался»;
//     дорожка сломана в мире (escBroken, марш убран); «Ещё раз» — в зале или вестибюле метро;
//  D  срыв, E — перелезть через балюстраду на соседнюю: жив, на соседней дорожке;
//  E  срыв у низа — донесло до низа: выбросило на нижнюю площадку, жив.
//
//   node tools/qa-metro-esc.mjs [--keep-server]   (скриншоты — tools/qa/metro-esc-*.png)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5283;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const keep = process.argv.includes('--keep-server');
const server = spawn(`npx vite --config tools/vite.qa.config.ts --port ${PORT} --strictPort`, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
const st = (page) => page.evaluate(() => window.__rfMetro.state());
const waitSt = async (page, fn, ms) => {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < ms) {
    s = await st(page);
    if (fn(s)) return s;
    await page.waitForTimeout(150);
  }
  return s;
};
const pressE = (page) => page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' })));

/** Встать на дорожку lane тоннеля на s м от низа (посередине поперёк), лицом вверх (или вниз). */
const standOn = (page, lane, s, faceDown = false) =>
  page.evaluate(
    async ({ lane, s, faceDown }) => {
      const v = window.__rf3d, c = v.fps;
      const L = window.__rfMetro.lanes().find((l) => l.lane === lane);
      const UP = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
      const a = L.width / 2;
      const p = L.up === 'N' ? [L.x0 + a, L.y1 - s] : L.up === 'S' ? [L.x0 + a, L.y0 + s] : L.up === 'E' ? [L.x0 + s, L.y0 + a] : [L.x1 - s, L.y0 + a];
      const t = L.len / L.steps, r = (L.z1 - L.z0) / L.steps;
      const nose = Math.min(L.z1, Math.max(L.z0, L.z0 + ((s + t) * r) / t));
      c.position.set(p[0], nose + 0.06 + v.posture.eye + 0.02, -p[1]);
      const [ux, uy] = UP[L.up];
      c.rotation.set(0.12, Math.atan2(faceDown ? -ux : ux, faceDown ? uy : -uy), 0);
      c.cameraDirection.setAll(0);
      c.cameraRotation.set(0, 0);
      await new Promise((r) => setTimeout(r, 120));
      return window.__rfMetro.state().lane;
    },
    { lane, s, faceDown },
  );

/** Найти (вырастить) эскалаторный тоннель с тремя целыми дорожками и перейти в него. */
const toTunnel = (page) =>
  page.evaluate(async () => {
    const S = window.__rfWalk, w = S.world, d = window.__rf3dFold;
    const isEsc = (i) => i.roomTags[0] === 'метро' && i.roomTags.includes('эскалатор') && !(i.escBroken ?? []).length;
    const seen = new Set();
    const q = [w.startId];
    let hit = S.rx.instances.find(isEsc);
    while (!hit && q.length && w.run().instances.length < 900) {
      const id = q.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      w.expand(id);
      for (const l of w.run().links) {
        if (l.kind === 'descent' || l.kind === 'lift' || l.sealed) continue;
        if (l.a.inst === id && !seen.has(l.b.inst)) q.push(l.b.inst);
        if (l.b.inst === id && !seen.has(l.a.inst)) q.push(l.a.inst);
      }
      if (w.run().instances.some((i) => i.roomId.startsWith('metro_esc_tunnel'))) {
        await new Promise((r) => setTimeout(r, 50));
        hit = S.rx.instances.find(isEsc);
      }
    }
    await new Promise((r) => setTimeout(r, 300));
    hit = S.rx.instances.find(isEsc);
    if (!hit) return null;
    d.goTo(hit.id);
    await new Promise((r) => setTimeout(r, 600));
    return { id: hit.id, roomId: hit.roomId, z: hit.z ?? 0, rooms: S.rx.instances.length, cur: d.portal?.current ?? d.current.center };
  });

/** Часы игры (кадры с dt ≤ 0.1 с, как у модулей прогулки): в swiftshader кадры медленные — игра идёт медленнее часов. */
const gameT = (page) => page.evaluate(() => window.__qaT);
/** Сколько проехал за ms (по оси дорожки), м, стоя смирно, и сколько прошло игрового времени, с. */
const rideFor = async (page, ms) => {
  const a = (await st(page)).lane, t0 = await gameT(page);
  await page.waitForTimeout(ms);
  const b = (await st(page)).lane, t1 = await gameT(page);
  return { a, b, ds: a && b ? b.s - a.s : null, dt: t1 - t0 };
};

let bad = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|AudioContext|autoplay/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
  for (let k = 0; ; k++) {
    try {
      await page.goto(BASE, { timeout: 180000 });
      break;
    } catch (e) {
      if (k >= 4) throw e;
      await page.waitForTimeout(3000);
    }
  }
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-metro-1', deadEndChance: 0.05, branching: 1, aheadDoors: 2, clusters: true, biome: 'metro', on: true }));
    localStorage.setItem('room-forge/metro-sound', '1');
  });
  for (let k = 0; ; k++) {
    await page.reload({ timeout: 180000 });
    await page.waitForTimeout(1000);
    try {
      await page.evaluate(async () => {
        const { mutate } = await import('/src/model/store.ts');
        mutate((p) => Object.assign(p.world, { trAfter: 100000 }));
      });
      await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 60000 });
      await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rfMetro, null, { timeout: 120000 });
      break;
    } catch (e) {
      if (k >= 5) throw e;
      errors.length = 0;
      await page.waitForTimeout(8000);
    }
  }
  await page.waitForFunction(() => window.__rf3d.props.ready, null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const sc = window.__rf3d.scene;
    window.__qaT = 0;
    sc.onBeforeRenderObservable.add(() => (window.__qaT += Math.min(0.1, sc.getEngine().getDeltaTime() / 1000 || 1 / 60)));
  });

  // ═════════════════ A ═════════════════
  const a0 = await waitSt(page, (s) => s.on, 15000);
  const env = await page.evaluate(() => {
    const sc = window.__rf3d.scene;
    const hemi = sc.lights.find((l) => l.name === 'hemi');
    const inst = window.__rfWalk.rx.instances.find((i) => i.id === window.__rfMetro.state().room);
    return { hemi: hemi?.intensity, tint: hemi ? [hemi.diffuse.r, hemi.diffuse.g, hemi.diffuse.b] : null, fog: [sc.fogMode, sc.fogStart, sc.fogEnd], room: inst?.roomId, tags: inst?.roomTags };
  });
  ok('A старт в метро: режим метро, холодный свет, туман', a0?.on && env.fog[0] === 3 && env.fog[2] === 56 && env.tint && env.tint[2] > env.tint[0], JSON.stringify(env));
  await page.screenshot({ path: out + 'metro-esc-1-start.png' });

  // ═════════════════ B ═════════════════
  const tun = await toTunnel(page);
  ok('B эскалаторный тоннель вырос, игрок в нём', !!tun && tun.cur === tun.id, JSON.stringify(tun));
  if (!tun) throw new Error('нет тоннеля');
  await page.evaluate(() => window.__rfMetro.noGrace());
  const lanes = await page.evaluate(() => window.__rfMetro.lanes());
  ok('B три дорожки, направления от сида', lanes.length === 3 && lanes.every((l) => !l.broken), JSON.stringify(lanes.map((l) => [l.lane, l.dir, l.up, +l.len.toFixed(2)])));
  const upL = lanes.find((l) => l.dir === 1), downL = lanes.find((l) => l.dir === -1), stopL = lanes.find((l) => l.dir === 0);
  // нижняя площадка, взгляд вверх по тоннелю
  await standOn(page, (upL ?? lanes[0]).lane, -1.6);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out + 'metro-esc-2-tunnel-bottom.png' });
  if (upL) {
    await standOn(page, upL.lane, 2);
    await page.waitForTimeout(300);
    const r = await rideFor(page, 3000);
    const k = upL.len / Math.hypot(upL.len, upL.z1 - upL.z0);
    const want = 0.75 * k * r.dt;
    ok('B лента вверх везёт: 0.75 м/с по наклону (по часам игры)', r.ds !== null && r.ds > want * 0.85 && r.ds < want * 1.15, JSON.stringify({ ds: r.ds, want, game: r.dt, ride: (await st(page)).ride }));
    ok('B ноги на линии носков (опора марша)', r.b && Math.abs(r.b.feet - r.b.nose - 0.06) < 0.25, JSON.stringify(r.b));
    await page.screenshot({ path: out + 'metro-esc-3-ride-up.png' });
  }
  if (downL) {
    await standOn(page, downL.lane, downL.len - 2, true);
    await page.waitForTimeout(300);
    const r = await rideFor(page, 3000);
    const want = -0.75 * (downL.len / Math.hypot(downL.len, downL.z1 - downL.z0)) * r.dt;
    ok('B лента вниз везёт вниз', r.ds !== null && r.ds < want * 0.85 && r.ds > want * 1.15, JSON.stringify({ ds: r.ds, want }));
    await page.screenshot({ path: out + 'metro-esc-4-ride-down.png' });
  }
  if (stopL) {
    await standOn(page, stopL.lane, 5);
    const r = await rideFor(page, 1500);
    ok('B стоящая дорожка не везёт', r.ds !== null && Math.abs(r.ds) < 0.05, JSON.stringify({ ds: r.ds }));
  }

  // ═════════════════ D: перелезть ═════════════════
  const mid = lanes[1];
  // как можно выше (перелезать можно не ближе ESC.climbEndM 1.2 к концам): у короткого тоннеля (марш 9.4) лента в
  // разгоне уносит к низу за ~2 с — подсказку и E проверять сразу, снимок — после
  await standOn(page, mid.lane, mid.len - 1.6);
  await page.waitForTimeout(400);
  const keyD = await page.evaluate((n) => window.__rfMetro.forceCollapse(n), mid.lane);
  ok('D срыв начался под игроком', !!keyD, keyD);
  const sh = await waitSt(page, (s) => s.runs.some((r) => r.stage === 'runaway'), 15000);
  ok('D рывок → лента бежит вниз, тревога', sh.runs.some((r) => r.stage === 'runaway') && sh.alarm === 'runaway', JSON.stringify({ runs: sh.runs, alarm: sh.alarm, climb: sh.climb }));
  const hud = await page
    .waitForFunction(() => /перелезть/.test(document.querySelector('.v3-lift-prompt')?.textContent ?? ''), null, { timeout: 3000, polling: 50 })
    .then(() => page.evaluate(() => document.querySelector('.v3-lift-prompt')?.textContent ?? null), () => null);
  ok('D подсказка «E — перелезть через балюстраду»', /перелезть/.test(hud ?? ''), String(hud));
  await pressE(page);
  await page.screenshot({ path: out + 'metro-esc-5-runaway.png' });
  const cl = await waitSt(page, (s) => !s.climbing && s.lane && s.lane.lane !== mid.lane, 10000);
  ok('D перелез на соседнюю дорожку, жив', cl && !cl.dead && !cl.falling && cl.lane && cl.lane.lane !== mid.lane, JSON.stringify({ lane: cl?.lane, dead: cl?.dead }));
  const brokeD = await page.waitForFunction((k) => {
    const [id, lane] = k.split('/');
    const i = window.__rfWalk.rx.instances.find((x) => x.id === id);
    return (i?.escBroken ?? []).includes(+lane);
  }, keyD, { timeout: 40000 }).then(() => true, () => false);
  ok('D обрыв: дорожка сломана в мире (escBroken), марш убран', brokeD);
  await page.waitForTimeout(2500);
  // обломки: с нижней площадки перед сломанной дорожкой, взгляд вверх по тоннелю
  await standOn(page, mid.lane, -2.0);
  await page.evaluate(() => (window.__rf3d.fps.rotation.x = -0.05));
  await page.waitForTimeout(800);
  await page.screenshot({ path: out + 'metro-esc-6-wreck.png' });
  const after = await page.evaluate((id) => {
    const i = window.__rfWalk.rx.instances.find((x) => x.id === id);
    return { flights: i.stair.flights.length, escLanes: i.escLanes?.length, broken: i.escBroken };
  }, tun.id);
  ok('D у экземпляра марш сломанной убран, escLanes — все три', after.flights === 2 && after.escLanes === 3, JSON.stringify(after));

  // ═════════════════ E: донесло до низа ═════════════════
  const rest = (await page.evaluate(() => window.__rfMetro.lanes())).filter((l) => !l.broken);
  const eL = rest[0];
  await standOn(page, eL.lane, 2.5);
  await page.evaluate(() => window.__rfMetro.noGrace());
  const keyE = await page.evaluate((n) => window.__rfMetro.forceCollapse(n), eL.lane);
  const th = await waitSt(page, (s) => s.thrown || s.falling || s.dead, 25000);
  ok('E донесло до низа: выбросило на нижнюю площадку, жив', th && th.thrown && !th.dead && !th.falling, JSON.stringify({ key: keyE, thrown: th?.thrown, falling: th?.falling, dead: th?.dead, lane: th?.lane }));
  // срыв доиграл (дорожка сломана в мире)
  await page.waitForFunction((k) => {
    const [id, lane] = k.split('/');
    return (window.__rfWalk.rx.instances.find((x) => x.id === id)?.escBroken ?? []).includes(+lane) && !window.__rfMetro.state().runs.length;
  }, keyE, { timeout: 40000 }).catch(() => {});

  // ═════════════════ C: падение и смерть ═════════════════
  const rest2 = (await page.evaluate(() => window.__rfMetro.lanes())).filter((l) => !l.broken);
  ok('C осталась целая дорожка', rest2.length >= 1, JSON.stringify(rest2.map((l) => l.lane)));
  if (rest2.length) {
    const cL = rest2[0];
    // лента до обрыва убежит 8.75 м по наклону: у короткого тоннеля (марш 9.4) даже с самого верха почти донесёт до низа,
    // а при редких кадрах (dt 0.1) — донесёт. Поэтому: срыв, и на бегущую ленту у верха — во второй половине разгона
    // (до обрыва убежит ≤ ~6.6 м) — не донесёт ни в каком тоннеле
    await page.evaluate(() => window.__rfMetro.noGrace());
    const keyC = await page.evaluate((n) => window.__rfMetro.forceCollapse(n), cL.lane);
    const midRun = await waitSt(page, (s) => s.runs.some((r) => r.key === keyC && r.stage === 'runaway' && r.t >= 2.4), 15000);
    await standOn(page, cL.lane, cL.len - 0.5, true);
    ok('C срыв у верха, игрок на бегущей ленте', !!keyC && midRun?.runs.some((r) => r.key === keyC), String(keyC));
    const fl = await waitSt(page, (s) => s.falling || s.dead, 30000);
    ok('C не успел: падение с лентой', fl && (fl.falling || fl.dead), JSON.stringify({ falling: fl?.falling, dead: fl?.dead, runs: fl?.runs }));
    await page.screenshot({ path: out + 'metro-esc-7-fall.png' });
    const dd = await waitSt(page, (s) => s.dead, 20000);
    await page.waitForTimeout(600);
    const panel = await page.evaluate(() => document.querySelector('.v3-obsh-dead h2')?.textContent ?? null);
    ok('C смерть: «Эскалатор сорвался», панель «Ещё раз»', dd?.dead && panel === 'Эскалатор сорвался', String(panel));
    await page.screenshot({ path: out + 'metro-esc-8-dead.png' });
    await page.evaluate(() => window.__rfMetro.retry());
    await page.waitForTimeout(1200);
    const rs = await st(page);
    const tags = await page.evaluate((room) => window.__rfWalk.rx.instances.find((i) => i.id === room)?.roomTags ?? null, rs.room);
    ok('C «Ещё раз» — в зале или вестибюле метро', !rs.dead && tags && tags[0] === 'метро' && (tags.includes('зал') || tags.includes('хаб')) && !tags.includes('эскалатор'), JSON.stringify({ room: rs.room, tags }));
    await page.screenshot({ path: out + 'metro-esc-9-respawn.png' });
  }
  const snd = (await st(page)).sound;
  ok('звук: срыв — рывок, хлопок цепи, грохот', snd.shudder >= 1 && snd.snap >= 1 && snd.crash >= 1, JSON.stringify(snd));
  ok('нет ошибок страницы', !errors.length, errors.slice(0, 5).join(' | '));
} catch (e) {
  console.error(e);
  bad++;
} finally {
  await browser.close();
  stopServer();
}
bad += results.filter((r) => !r.ok).length;
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(bad ? 1 : 0);
