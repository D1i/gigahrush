// QA «Прогулки» в общаге в браузере (docs/LOCATIONS.md, «Общага: двери, темнота, рука, лампа»):
//  A  старт в вестибюле общаги: коридоры видны, свет тусклый тёплый;
//  B  дверь комнаты: E — распахнулась; пока на неё смотрят — стоит открытой; отвернулся — закрылась сама;
//     запертая (за ней нет комнаты) — «Заперто»;
//  C  лампа у вахтёра: E — взял (спот пуст, модель в руке, жёлтый свет); операция мира 'lamp' — повторно не взять;
//  D  отключение: свет погас (почти чёрно); рука из невидимой двери ползёт, пока её не видят; с лампой — видна и замирает,
//     к ней с лампой — уползает; свет вернулся — руки нет;
//  E  без лампы рука хватает: волочение, чёрный экран, «Тебя утащили за дверь» → «Ещё раз» — в вестибюле;
//  F  (если вырос) затопленный подвал — вода по пояс.
//  H  встреча: отключение, игрок идёт как обычно лицом вперёд (без лампы) в коридоре, комнате, кухне, вестибюле, подвале —
//     рука ≤ 4 с в 4–10 м пути, сзади или сбоку, хватает стоящего ≤ 15 с; с лампой — рядом в её свете, не хватает;
//  G  кооп (два игрока, хост A): дверь, открытая клиентом B, — у хоста; темнота хоста — у B; лампа B — PlayerState.lamp;
//     рука хоста хватает B — у B волочение и смерть, у A — B «погиб»; «Ещё раз» — B рядом с A.  (--no-coop — пропустить)
//
//   node tools/qa-obshaga-walk.mjs [--keep-server]   (скриншоты — tools/qa/obsh-*.png)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5245;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const keep = process.argv.includes('--keep-server');
// без слежения за файлами: в дереве параллельно правят другие сессии (tools/vite.qa.config.ts)
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

const st = (page) => page.evaluate(() => window.__rfObshaga.state());
const pressE = (page) => page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' })));
/** Ждать условия на состоянии общаги (fn — строка тела функции от s), до ms. */
const waitSt = async (page, fn, ms) => {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < ms) {
    s = await st(page);
    if (fn(s)) return s;
    await page.waitForTimeout(250);
  }
  return s;
};

/** Встать в комнате room в точке плана (x, y), лицом к точке плана (tx, ty). */
const standAt = (page, room, x, y, tx, ty) =>
  page.evaluate(
    async ({ room, x, y, tx, ty }) => {
      const d = window.__rf3dFold, v = window.__rf3d;
      const cur = d.portal?.current ?? d.current.center;
      if (cur !== room) d.goTo(room);
      await new Promise((r) => setTimeout(r, 300));
      const z = window.__rfObshaga.nav().rooms.get(room)?.z ?? 0;
      const c = v.fps;
      c.position.set(x, z + v.posture.eye + 0.05, -y);
      c.rotation.set(0.04, Math.atan2(tx - x, -(ty - y)), 0);
      c.cameraDirection.setAll(0);
      c.cameraRotation.set(0, 0);
      return { cur: d.portal?.current ?? d.current.center };
    },
    { room, x, y, tx, ty },
  );
/** Идти кадрами к точке плана (как от клавиш: cameraDirection каждый кадр); → где оказался (план) и комната. */
const walkTo = (page, tx, ty, frames = 80, step = 0.03) =>
  page.evaluate(
    async ({ tx, ty, frames, step }) => {
      const c = window.__rf3d.fps;
      const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      for (let k = 0; k < frames; k++) {
        const dx = tx - c.position.x, dz = -ty - c.position.z, d = Math.hypot(dx, dz);
        if (d < 0.05) break;
        c.rotation.y = Math.atan2(dx, dz);
        c.cameraDirection.set((dx / d) * Math.min(step, d), 0, (dz / d) * Math.min(step, d));
        await frame();
      }
      c.cameraDirection.setAll(0);
      await frame();
      const d = window.__rf3dFold;
      return { x: c.position.x, y: -c.position.z, room: d.portal?.current ?? d.current.center };
    },
    { tx, ty, frames, step },
  );
const sound = (page) => page.evaluate(() => ({ ...window.__rfObshaga.state().sound }));

/** Игрок-«бот» (в странице): идёт по общаге как человек — 1.7 м/с, лицом вперёд, по коридорам дальше вперёд, изредка
 *  заходит в комнаты (E у двери). stand — стоять, пока есть рука; until — 'light' (идти, пока темно) или секунды. */
const BOT = async ({ seconds, seed = 1, enterP = 0.25, stand = false, until = null, stopOnHand = false }) => {
  const v = window.__rf3d, c = v.fps, d = window.__rf3dFold, O = window.__rfObshaga;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  let rs = seed >>> 0 || 1;
  const rnd = () => (rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296;
  const cur = () => d.portal?.current ?? d.current.center;
  const SPEED = 1.7;
  let wp = [];
  let prev = null;
  let stuckT = 0, stuckAt = null;
  const t0 = performance.now();
  let tp = t0;
  let sawDark = false;
  let moved = 0;
  const rooms = new Set();
  const doorBetween = (nav, a, b) => nav.doors.find((x) => x.room && ((x.cor === a && x.room === b) || (x.room === a && x.cor === b)));
  const plan = () => {
    const nav = O.nav();
    const room = cur();
    const r = nav.rooms.get(room);
    if (!r) return;
    rooms.add(room);
    const px = c.position.x, py = -c.position.z;
    const fx = Math.sin(c.rotation.y), fy = -Math.cos(c.rotation.y);
    let opts = r.edges.filter((e) => nav.rooms.get(e.to)?.obsh);
    if (opts.length > 1 && prev) opts = opts.filter((e) => e.to !== prev);
    const into = opts.filter((e) => doorBetween(nav, room, e.to)?.room === e.to);
    const pass = opts.filter((e) => !into.includes(e));
    let pick = null;
    if (into.length && rnd() < enterP) pick = into[Math.floor(rnd() * into.length)];
    else if (pass.length) pick = pass.map((e) => {
      const dx = e.x - px, dy = e.y - py, l = Math.hypot(dx, dy) || 1;
      return { e, s: (dx * fx + dy * fy) / l + rnd() * 0.9 };
    }).sort((a, b) => b.s - a.s)[0].e;
    else if (opts.length) pick = opts[Math.floor(rnd() * opts.length)];
    if (!pick) return;
    prev = room;
    const door = doorBetween(nav, room, pick.to);
    if (door) {
      const s = door.room === pick.to ? -1 : 1; // знак нормали «в коридор»: в комнату — против неё
      wp.push({ x: door.x - s * door.nx * 0.9, y: door.y - s * door.ny * 0.9, door: door.id });
      wp.push({ x: door.x + s * door.nx * 1.1, y: door.y + s * door.ny * 1.1 });
      if (door.room === pick.to) wp.push({ wait: 1 + rnd() * 1.5 });
    } else {
      const dx = pick.x - px, dy = pick.y - py, l = Math.hypot(dx, dy) || 1;
      wp.push({ x: pick.x, y: pick.y });
      wp.push({ x: pick.x + (dx / l) * 0.7, y: pick.y + (dy / l) * 0.7 });
    }
  };
  let waitUntil = 0, doorWait = 0;
  for (;;) {
    await frame();
    const now = performance.now();
    const dt = Math.min(0.1, (now - tp) / 1000);
    tp = now;
    const s = O.state();
    if (s.phase === 'dark') sawDark = true;
    if (until === 'light' ? sawDark && s.phase !== 'dark' : now - t0 > seconds * 1000) break;
    if (now - t0 > (seconds ?? 300) * 1000) break;
    if (stopOnHand && s.hand) break;
    if (s.dead) break;
    if (s.dragging || (stand && s.hand)) {
      c.cameraDirection.setAll(0);
      wp = [];
      continue;
    }
    if (now < waitUntil) continue;
    if (!wp.length) plan();
    const w = wp[0];
    if (!w) continue;
    if (w.wait !== undefined) {
      waitUntil = now + w.wait * 1000;
      wp.shift();
      continue;
    }
    const px = c.position.x, py = -c.position.z;
    const dx = w.x - px, dy = w.y - py, l = Math.hypot(dx, dy);
    if (l < 0.22) {
      if (w.door) {
        const open = s.doors[w.door] ?? 0;
        if (open < 0.9) {
          if (!doorWait) {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' }));
            doorWait = now;
          }
          if (now - doorWait < 3500) continue;
          // не открылась (заперта?) — другой путь
          wp = [];
          prev = null;
          doorWait = 0;
          continue;
        }
        doorWait = 0;
      }
      wp.shift();
      if (!wp.length) prev = prev ?? null;
      continue;
    }
    // лицом по ходу (плавно)
    const want = Math.atan2(dx, -dy);
    let dy2 = want - c.rotation.y;
    dy2 = Math.atan2(Math.sin(dy2), Math.cos(dy2));
    c.rotation.y += dy2 * Math.min(1, dt * 8);
    c.rotation.x = 0.04;
    const step = Math.min(SPEED * dt, l);
    c.cameraDirection.set((dx / l) * step, 0, (-dy / l) * step);
    moved += step;
    // застрял — другой путь
    if (!stuckAt) stuckAt = { x: px, y: py, t: now };
    else if (now - stuckAt.t > 2500) {
      if (Math.hypot(px - stuckAt.x, py - stuckAt.y) < 0.3) {
        wp = [];
        prev = null;
        stuckT++;
      }
      stuckAt = { x: px, y: py, t: now };
    }
  }
  c.cameraDirection.setAll(0);
  return { rooms: rooms.size, stuck: stuckT, walked: +moved.toFixed(1), s: ((performance.now() - t0) / 1000).toFixed(1) };
};

/** Повернуться лицом к точке плана (или спиной). */
const face = (page, tx, ty, back = false) =>
  page.evaluate(({ tx, ty, back }) => {
    const c = window.__rf3d.fps;
    const a = Math.atan2(tx - c.position.x, -ty - c.position.z);
    c.rotation.y = back ? a + Math.PI : a;
    c.rotation.x = 0.04;
  }, { tx, ty, back });

/** Игрок кооп-лобби: свой контекст, прогулка в общаге. */
async function coopPlayer(name, color, br) {
  const ctx = await br.newContext({ viewport: { width: 1100, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|WebSocket|ERR_CONNECTION_REFUSED|AudioContext|autoplay/i.test(m.text()) && errors.push(`${name} ${m.text().slice(0, 300)}`));
  await go(page, BASE);
  await page.evaluate(({ name, color }) => {
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-obsh-coop', deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, biome: 'obshaga', on: true }));
    localStorage.setItem('room-forge/coop/profile', JSON.stringify({ name, color, server: '', lastLobby: '' }));
    localStorage.setItem('room-forge/obshaga-sound', '0');
  }, { name, color });
  await page.reload({ timeout: 180000 });
  await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 180000 });
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rfObshaga, null, { timeout: 180000 });
  return page;
}
const online = (page) => page.waitForFunction(() => window.__rfCoop?.co?.status === 'online' && window.__rf3dFold?.portal?.isActive && window.__rfObshaga?.state().on, null, { timeout: 180000 });

async function coopStage() {
  // свой браузер: после долгой первой части (свой GPU-процесс, память) два игрока на swiftshader подключаются надёжнее
  const br = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    await coopRun(br);
  } finally {
    await br.close();
  }
}

async function coopRun(br) {
  const A = await coopPlayer('A', '#e0563f', br);
  const B = await coopPlayer('B', '#4fb3e8', br);
  await A.getByRole('button', { name: 'Подключить онлайн' }).click();
  await A.getByRole('button', { name: 'Создать лобби' }).click();
  await online(A);
  const code = await A.locator('input.coop-code').inputValue();
  await A.getByRole('button', { name: 'Играть' }).click();
  await B.getByRole('button', { name: 'Подключить онлайн' }).click();
  await B.locator('input.coop-code').fill(code);
  await B.getByRole('button', { name: 'Подключиться' }).click();
  await online(B);
  await B.getByRole('button', { name: 'Играть' }).click();
  await B.waitForTimeout(1500);
  const sa0 = await st(A), sb0 = await st(B);
  const coInfo = (p) => p.evaluate(() => {
    const co = window.__rfCoop?.co;
    return { status: co?.status, me: co?.me.id.slice(0, 6), host: co?.host?.slice(0, 6), seq: co?.lastSeq, players: [...(co?.players.values() ?? [])].map((x) => ({ id: x.id.slice(0, 6), room: x.state?.room ?? null, lamp: x.state?.lamp ?? 0, loc: x.state?.loc ?? null })) };
  });
  console.log('    A', JSON.stringify(await coInfo(A)), ' | B', JSON.stringify(await coInfo(B)));
  ok('G лобби в общаге: A ведёт режиссёра (хост), B — по срезу хоста', sa0.on && sb0.on && sa0.authority && !sb0.authority, JSON.stringify({ a: sa0.authority, b: sb0.authority }));
  // дверь: B у двери комнаты, E — открывается у хоста и у B
  const door = await B.evaluate(() => {
    const nav = window.__rfObshaga.nav();
    const s = window.__rfWalk;
    const hub = s.world.startId;
    const seen = new Map([[hub, 0]]);
    const q = [hub];
    for (let k = 0; k < q.length; k++) for (const e of nav.rooms.get(q[k]).edges) if (!seen.has(e.to)) (seen.set(e.to, seen.get(q[k]) + 1), q.push(e.to));
    return nav.doors.filter((d) => d.room && seen.has(d.cor) && seen.get(d.cor) > 0).sort((a, b) => seen.get(a.cor) - seen.get(b.cor))[0] ?? null;
  });
  if (door) {
    await standAt(B, door.cor, door.x + door.nx * 1.0, door.y + door.ny * 1.0, door.x, door.y);
    await B.waitForTimeout(1000);
    await pressE(B);
    const a1 = await waitSt(A, (s) => (s.doors[door.id] ?? 0) > 0.9, 20000);
    const b1 = await waitSt(B, (s) => (s.doors[door.id] ?? 0) > 0.9, 20000);
    if ((a1.doors[door.id] ?? 0) <= 0.9) console.log('    A', JSON.stringify(await coInfo(A)), ' | B', JSON.stringify(await coInfo(B)), JSON.stringify({ near: b1.nearDoor, room: b1.room }));
    ok('G B открыл дверь (E) — она открыта у хоста и у B', (a1.doors[door.id] ?? 0) > 0.9 && (b1.doors[door.id] ?? 0) > 0.9, JSON.stringify({ a: a1.doors[door.id], b: b1.doors[door.id] }));
    await B.screenshot({ path: out + 'obsh-16-coop-B-door.png' });
  }
  // темнота у хоста — у B
  await A.evaluate(() => window.__rfObshaga.forceBlackout(true));
  const b2 = await waitSt(B, (s) => s.phase === 'dark', 20000);
  ok('G хост: отключение — у B тоже темно', b2.phase === 'dark' && b2.level === 0, b2.phase);
  // лампа у B: состояние игрока
  await B.evaluate(() => window.__rfObshaga.giveLantern(true));
  const lampA = await A.waitForFunction(() => [...window.__rfCoop.co.players.values()].some((p) => p.state?.lamp === 1), null, { timeout: 20000 }).then(() => true, () => false);
  ok('G лампа у B — у хоста PlayerState.lamp = 1', lampA);
  // A — с лампой в вестибюле, B — без лампы в коридоре: рука хоста хватает B
  await A.evaluate(() => window.__rfObshaga.giveLantern(true));
  await B.evaluate(() => window.__rfObshaga.giveLantern(false));
  const spot = await B.evaluate(() => {
    const nav = window.__rfObshaga.nav();
    const s = window.__rfWalk;
    const hub = s.world.startId;
    const cor = nav.rooms.get(hub).edges.map((e) => nav.rooms.get(e.to)).find((r) => s.rx.instances.find((i) => i.id === r.id)?.roomTags.includes('коридор'));
    return cor ? { room: cor.id, x: (cor.x0 + cor.x1) / 2, y: (cor.y0 + cor.y1) / 2 } : null;
  });
  if (spot) {
    await standAt(B, spot.room, spot.x, spot.y, spot.x + 1, spot.y);
    await B.waitForTimeout(1200);
    const hd = await A.evaluate(() => window.__rfObshaga.spawnHandNear());
    const seenB = await waitSt(B, (s) => !!s.hand, 20000);
    ok('G рука хоста — у B видна в срезе', !!hd && !!seenB.hand, JSON.stringify({ hd, hand: seenB.hand?.phase }));
    const dp = await B.evaluate((id) => window.__rfObshaga.nav().doorById.get(id), hd);
    if (dp) await face(B, dp.x, dp.y, true);
    const gb = await waitSt(B, (s) => s.dragging || s.dead, 60000);
    ok('G рука схватила B — у B волочение', gb.dragging || gb.dead, JSON.stringify({ dragging: gb.dragging, hand: gb.hand?.phase, victim: gb.hand?.victim }));
    if (gb.dragging) await B.screenshot({ path: out + 'obsh-17-coop-B-dragged.png' });
    const db = await waitSt(B, (s) => s.dead, 40000);
    const deadAtA = await A.waitForFunction(() => [...window.__rfCoop.co.players.values()].some((p) => p.state?.dead === 1), null, { timeout: 20000 }).then(() => true, () => false);
    ok('G B утащили — у хоста B «погиб» (PlayerState.dead)', db.dead && deadAtA);
    await B.waitForSelector('.v3-obsh-dead', { timeout: 5000 }).catch(() => {});
    await B.getByRole('button', { name: 'Ещё раз' }).click();
    await B.waitForTimeout(1800);
    const [ra, rb] = await Promise.all([A, B].map((p) => p.evaluate(() => window.__rf3dFold.portal.current)));
    const b3 = await st(B);
    ok('G «Ещё раз» — B жив, рядом с A', !b3.dead && ra === rb, JSON.stringify({ a: ra, b: rb }));
    await B.screenshot({ path: out + 'obsh-18-coop-B-respawn.png' });
  }
  await A.evaluate(() => window.__rfObshaga.lightsBack());
  await A.context().close();
  await B.context().close();
}

// прогрев: vite собирает зависимости (Babylon и т. п.) до проверки; пересборка посреди прогона (504 Outdated Optimize Dep)
// подгрузила бы две копии модулей Babylon — повторять, пока загрузка «3D» не пройдёт без неё
for (let k = 0; k < 5; k++) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let stale = false;
  page.on('response', (r) => r.status() === 504 && (stale = true));
  try {
    await go(page, BASE);
    await page.evaluate(() => localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-warm', clusters: true, biome: 'obshaga', on: true })));
    await page.reload({ timeout: 180000 });
    await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 120000 });
    await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rf3d?.props?.ready, null, { timeout: 180000 });
    await page.waitForTimeout(3000);
  } catch {
    stale = true;
  }
  await ctx.close();
  if (!stale) break;
  console.log('…   прогрев: vite пересобрал зависимости — ещё раз');
  await new Promise((r) => setTimeout(r, 4000));
}


/** Диагностика (--diag): бот ходит по общаге как человек без лампы, три естественных отключения подряд; журнал встреч. */
async function diagStage(page) {
  await page.evaluate(() => window.__rfObshaga.diagReset());
  for (let k = 0; k < 3; k++) {
    console.log('…   прогулка при свете', JSON.stringify(await page.evaluate(BOT, { seconds: 20, seed: 11 + k })));
    await page.evaluate(() => window.__rfObshaga.forceBlackout(false));
    for (let guard = 0; guard < 6; guard++) {
      const r = await page.evaluate(BOT, { seconds: 110, seed: 100 + k * 7 + guard, until: 'light' });
      const s = await st(page);
      console.log('…   в темноте', JSON.stringify(r), s.phase, s.dead ? 'УТАЩИЛИ' : '');
      if (s.dead) {
        await page.evaluate(() => window.__rfObshaga.retry());
        await page.waitForTimeout(800);
        continue;
      }
      if (s.phase !== 'dark') break;
    }
  }
  const diag = await page.evaluate(() => window.__rfObshaga.diag());
  for (const b of diag) console.log('ДИАГ', JSON.stringify(b));
  return diag;
}

/** Места для испытаний встречи: коридор, жилая комната, кухня, вестибюль, затопленный подвал (если вырос). */
const trialSpots = (page) =>
  page.evaluate(() => {
    const nav = window.__rfObshaga.nav();
    const s = window.__rfWalk;
    const hub = s.world.startId;
    const tags = (id) => s.rx.instances.find((i) => i.id === id)?.roomTags ?? [];
    const hops = new Map([[hub, 0]]);
    const q = [hub];
    for (let k = 0; k < q.length; k++) for (const e of nav.rooms.get(q[k]).edges) if (!hops.has(e.to)) (hops.set(e.to, hops.get(q[k]) + 1), q.push(e.to));
    const near = (pred) => [...hops.entries()].filter(([id]) => pred(id)).sort((a, b) => a[1] - b[1]).map(([id]) => id);
    const center = (id) => {
      const r = nav.rooms.get(id);
      return { room: id, x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
    };
    const out = [];
    // коридор через пару кусков от вестибюля: середина, лицом вдоль
    const cor = near((id) => tags(id).includes('коридор') && !tags(id).includes('подвал') && hops.get(id) >= 2)[0];
    if (cor) {
      const r = nav.rooms.get(cor);
      const c = center(cor);
      const along = r.x1 - r.x0 >= r.y1 - r.y0;
      out.push({ kind: 'коридор', ...c, tx: c.x + (along ? 5 : 0), ty: c.y + (along ? 0 : 5) });
    }
    // жилая комната и кухня: у дальней от двери стены, лицом к двери (выйдет в коридор)
    for (const [kind, tag] of [['жилая комната', ['комната']], ['кухня', ['кухня', 'туалет', 'прачечная']]]) {
      const id = near((x) => tag.some((t) => tags(x).includes(t)))[0];
      const d = id && nav.doors.find((x) => x.room === id);
      if (!d) continue;
      out.push({ kind, room: id, x: d.x - d.nx * 2.2, y: d.y - d.ny * 2.2, tx: d.x, ty: d.y });
    }
    // вестибюль: у прохода в коридор, лицом в зал
    {
      const e = nav.rooms.get(hub).edges.find((x) => tags(x.to).includes('коридор'));
      const r = nav.rooms.get(hub);
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
      const ux = cx - e.x, uy = cy - e.y, l = Math.hypot(ux, uy) || 1;
      out.push({ kind: 'вестибюль', room: hub, x: e.x + (ux / l) * 1.2, y: e.y + (uy / l) * 1.2, tx: cx, ty: cy });
    }
    // затопленный подвал
    const bsm = near((id) => nav.rooms.get(id)?.flooded)[0];
    if (bsm) {
      const r = nav.rooms.get(bsm);
      const c = center(bsm);
      const along = r.x1 - r.x0 >= r.y1 - r.y0;
      out.push({ kind: 'подвал', ...c, tx: c.x + (along ? 5 : 0), ty: c.y + (along ? 0 : 5) });
    }
    return out;
  });

/** Испытание встречи: отключение, игрок идёт как обычно (лицом вперёд), пока руки нет, потом стоит. */
async function encounter(page, spot, k, lantern = false) {
  await page.evaluate(() => window.__rfObshaga.lightsBack());
  const s0 = await waitSt(page, (s) => s.phase === 'lit' || s.dead, 6000);
  if (s0.dead) await page.evaluate(() => window.__rfObshaga.retry());
  await page.evaluate(() => window.__rfObshaga.noGrace());
  await standAt(page, spot.room, spot.x, spot.y, spot.tx, spot.ty);
  await page.evaluate((on) => window.__rfObshaga.giveLantern(on), lantern);
  await page.waitForTimeout(1200);
  // свет моргнул и погас — сейчас; счёт секунд — от отключения (диагностика режиссёра)
  await page.evaluate(() => {
    window.__rfObshaga.diagReset();
    window.__rfObshaga.forceBlackout(true);
  });
  const walk = await page.evaluate(BOT, { seconds: 4.5, seed: 500 + k, enterP: 0, stopOnHand: true });
  // появилась ли — по времени режиссёра (диагностика); настенных — с запасом на медленный рендер
  const spawned = await waitSt(page, (s) => !!s.hand, 15000);
  void walk;
  const d0 = (await page.evaluate(() => window.__rfObshaga.diag()))[0] ?? null;
  if (process.argv.includes('--verbose')) console.log('    двери появления:', JSON.stringify(await page.evaluate(() => window.__rfObshaga.cands())));
  const sp = d0?.spawns?.[0] ?? null;
  const res = { kind: spot.kind, spawnT: sp?.t ?? null, dist: sp?.dist ?? null, facing: sp?.facing ?? null, grabT: null, minGap: null };
  if (!spawned?.hand) {
    // почему руки нет — из диагностики режиссёра
    res.why = { ...(d0?.noSpawn ?? {}), room: (await st(page)).room, on: (await st(page)).on, phase: (await st(page)).phase };
    return res;
  }
  // стоит на месте (лицом вперёд); время — режиссёра (при малом fps рендера оно идёт медленнее настенного)
  const t0 = Date.now();
  for (;;) {
    const s = await st(page);
    const dg = (await page.evaluate(() => window.__rfObshaga.diag()))[0];
    if (s.dragging || s.dead) {
      res.grabT = dg?.grabAt?.[0] ?? null;
      break;
    }
    if (s.hand) {
      const gap = await page.evaluate(({ x, y }) => Math.hypot(window.__rf3d.fps.position.x - x, -window.__rf3d.fps.position.z - y), s.hand.tip);
      res.minGap = res.minGap === null ? +gap.toFixed(2) : Math.min(res.minGap, +gap.toFixed(2));
    }
    // 16 с режиссёра (по руке — с её появления), не дольше минуты настенных
    if (Date.now() - t0 > 60000 || (s.hand && (await page.evaluate(() => window.__rfObshaga.handAge())) > 16)) break;
    await page.waitForTimeout(300);
  }
  return res;
}

/** Мир вокруг старта — дальше, пока не вырастет затопленный подвал (как если бы игрок дошёл; до 14 шагов). */
const growToBasement = (page) =>
  page.evaluate(async () => {
    const s = window.__rfWalk;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const tried = new Set();
    for (let k = 0; k < 14; k++) {
      const nav = window.__rfObshaga.nav();
      if ([...nav.rooms.values()].some((r) => r.flooded)) return true;
      // спуски в подвал — раскрыть за ними; иначе — самый дальний ещё не тронутый коридор
      const down = s.rx.instances.filter((i) => i.roomId === 'obsh_stair_down' && !tried.has(i.id));
      const far = down.length ? down : s.rx.instances.filter((i) => i.roomTags.includes('коридор') && !tried.has(i.id)).slice(-3);
      for (const i of far) {
        tried.add(i.id);
        s.enter(i.id);
      }
      await sleep(400);
    }
    return [...window.__rfObshaga.nav().rooms.values()].some((r) => r.flooded);
  });

async function stageH(page) {
  const grown = await growToBasement(page);
  console.log('…   подвал в мире:', grown);
  await page.waitForTimeout(800);
  const spots = await trialSpots(page);
  ok('H места испытаний: коридор, комнаты, вестибюль (и подвал, если вырос)', spots.length >= 4, spots.map((s) => s.kind).join(', '));
  const rs = [];
  for (let k = 0; k < spots.length; k++) {
    const r = await encounter(page, spots[k], k);
    rs.push(r);
    console.log('…   встреча', JSON.stringify(r));
    if (k === 0 && r.grabT !== null) await page.screenshot({ path: out + 'obsh-19-grabbed-natural.png' });
  }
  const good = rs.filter((r) => r.spawnT !== null && r.spawnT <= 4 && r.dist >= 4 && r.dist <= 10 && r.grabT !== null && r.grabT <= 15);
  ok(`H без лампы: рука ≤ 4 с после отключения в 4–10 м пути и хватает стоящего ≤ 15 с — ${good.length} из ${rs.length}`, good.length >= Math.min(4, rs.length) && good.length >= rs.length - 1, rs.map((r) => `${r.kind}: ${r.spawnT}с ${r.dist}м ${r.grabT}с`).join(' · '));
  ok('H рука вылезает сзади или сбоку (facing ≤ 0.3)', rs.filter((r) => r.facing !== null && r.facing <= 0.3).length >= rs.filter((r) => r.facing !== null).length - 1, rs.map((r) => r.facing).join(', '));
  // с лампой: рука рядом, в свете лампы, но не хватает; повернулся — видит её, она замерла; пошёл на неё — уползает
  await page.evaluate(() => window.__rfObshaga.lightsBack());
  await page.waitForTimeout(400);
  if ((await st(page)).dead) await page.evaluate(() => window.__rfObshaga.retry());
  const spot = spots[0];
  const r = await encounter(page, spot, 99, true);
  console.log('…   с лампой', JSON.stringify(r));
  const s1 = await st(page);
  ok('H с лампой: рука появилась рядом (≤ 10 м), не схватила за 16 с, не ближе поля', r.spawnT !== null && r.dist <= 10 && r.grabT === null && !s1.dead && (r.minGap ?? 9) > 2.5, JSON.stringify(r));
  if (s1.hand) {
    await face(page, s1.hand.tip.x, s1.hand.tip.y);
    await page.waitForTimeout(800);
    const s2 = await waitSt(page, (s) => !s.hand || (s.seesHand && (s.hand.frozen || s.hand.phase === 'retreating')), 3000);
    const gap = await page.evaluate(({ x, y }) => Math.hypot(window.__rf3d.fps.position.x - x, -window.__rf3d.fps.position.z - y), s2.hand?.tip ?? s1.hand.tip);
    ok('H с лампой: повернулся — рука в свете лампы, видна и замерла', !!s2.hand && s2.seesHand && (s2.hand.frozen || s2.hand.phase === 'retreating') && gap < 6.5, JSON.stringify({ sees: s2.seesHand, phase: s2.hand?.phase, frozen: s2.hand?.frozen, gap: +gap.toFixed(2) }));
    await page.screenshot({ path: out + 'obsh-20-hand-behind-lantern.png' });
  } else ok('H с лампой: рука рядом', false, 'руки нет');
  await page.evaluate(() => {
    window.__rfObshaga.lightsBack();
    window.__rfObshaga.giveLantern(false);
  });
}

let spot = null;
try {
  if (process.argv.includes('--coop-only')) {
    await coopStage();
    throw 'coop-only';
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|AudioContext|autoplay/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
  await go(page, BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-obsh-1', deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, biome: 'obshaga', on: true }));
    localStorage.setItem('room-forge/obshaga-sound', '1');
  });
  // vite мог пересобрать зависимости посреди первой загрузки (504 Outdated Optimize Dep) — тогда ещё раз
  for (let k = 0; ; k++) {
    await page.reload({ timeout: 180000 });
    await page.waitForTimeout(1000);
    try {
      await page.evaluate(async () => {
        const { mutate } = await import('/src/model/store.ts');
        mutate((p) => Object.assign(p.world, { trAfter: 100000 }));
      });
      await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 60000 });
      await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rfObshaga, null, { timeout: 120000 });
      break;
    } catch (e) {
      if (k >= 5) throw e;
      errors.length = 0;
      await page.waitForTimeout(8000);
    }
  }
  // модели предметов догрузились, куски пересобраны
  await page.waitForFunction(() => window.__rf3d.props.ready, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  // естественных отключений нет — только forceBlackout проверки (первое моргание теперь через 25–45 с)
  await page.evaluate(() => window.__rfObshaga.calm(true));

  if (process.argv.includes('--diag')) {
    await diagStage(page);
    throw 'coop-only';
  }
  if (process.argv.includes('--meet')) {
    await stageH(page);
    throw 'coop-only';
  }

  // ═════════════════ A: вестибюль ═════════════════
  const a0 = await waitSt(page, (s) => s.on, 15000);
  ok('A старт в общаге: режим общаги включён, свет горит', a0?.on && a0.phase === 'lit' && a0.level === 1, JSON.stringify({ on: a0?.on, phase: a0?.phase, room: a0?.room }));
  const light0 = await page.evaluate(() => window.__rf3d.scene.lights.find((l) => l.name === 'hemi').intensity);
  ok('A свет тусклый и тёплый (hemi ниже обычного 0.85)', light0 > 0.3 && light0 < 0.7, String(light0));
  const info = await page.evaluate(() => {
    const nav = window.__rfObshaga.nav();
    const s = window.__rfWalk;
    const room = window.__rf3dFold.portal.current;
    const inst = s.rx.instances.find((i) => i.id === room);
    return { roomId: inst.roomId, doors: nav.doors.length, lamps: nav.lamps.length, rooms: s.rx.instances.length };
  });
  ok('A вестибюль с вахтой, вокруг — двери комнат и лампа', info.roomId === 'obsh_hub_vahta' && info.doors > 4 && info.lamps >= 1, JSON.stringify(info));
  await page.screenshot({ path: out + 'obsh-1-hub.png' });

  // ═════════════════ B: дверь комнаты закрывается сама ═════════════════
  // ближайшая к вестибюлю связанная дверь комнаты в коридоре (не вахтёрская)
  const door = await page.evaluate(() => {
    const nav = window.__rfObshaga.nav();
    const s = window.__rfWalk;
    const hub = window.__rf3dFold.portal.current;
    const seen = new Map([[hub, 0]]);
    const q = [hub];
    for (let k = 0; k < q.length; k++) for (const e of nav.rooms.get(q[k]).edges) if (!seen.has(e.to)) (seen.set(e.to, seen.get(q[k]) + 1), q.push(e.to));
    const tags = (id) => s.rx.instances.find((i) => i.id === id)?.roomTags ?? [];
    const list = nav.doors.filter((d) => d.room && seen.has(d.cor) && tags(d.cor).includes('коридор') && tags(d.room).includes('комната')).sort((a, b) => seen.get(a.cor) - seen.get(b.cor));
    const d = list[0];
    const dead = nav.doors.filter((x) => !x.room && seen.has(x.cor)).sort((a, b) => seen.get(a.cor) - seen.get(b.cor))[0] ?? null;
    return d ? { ...d, dead } : null;
  });
  ok('B в коридоре рядом — дверь жилой комнаты', !!door, JSON.stringify(door && { id: door.id, cor: door.cor }));
  if (door) {
    const mx = door.x + door.nx * 1.0, my = door.y + door.ny * 1.0;
    await standAt(page, door.cor, mx, my, door.x, door.y);
    await page.waitForTimeout(1200);
    const b0 = await st(page);
    ok('B у двери: подсказка «E — открыть дверь», дверь закрыта', b0.nearDoor === door.id && /открыть дверь/.test(b0.prompt ?? '') && !b0.doors[door.id], JSON.stringify({ near: b0.nearDoor, prompt: b0.prompt }));
    await page.screenshot({ path: out + 'obsh-2-door-closed.png' });
    const blockedAt = await walkTo(page, door.x - door.nx * 1.2, door.y - door.ny * 1.2, 70);
    const nIn = (p) => (p.x - door.x) * door.nx + (p.y - door.y) * door.ny;
    ok('B закрытая дверь не пускает (полотно — коллайдер)', blockedAt.room !== door.room && nIn(blockedAt) > 0.1, JSON.stringify({ room: blockedAt.room, n: +nIn(blockedAt).toFixed(2) }));
    await standAt(page, door.cor, mx, my, door.x, door.y);
    await page.waitForTimeout(400);
    const snd0 = await sound(page);
    await pressE(page);
    const b1 = await waitSt(page, (s) => (s.doors[door.id] ?? 0) >= 0.99, 6000);
    ok('B E — дверь распахнулась', (b1.doors[door.id] ?? 0) >= 0.99, JSON.stringify(b1.doors));
    const snd1 = await sound(page);
    ok('B звук: скрип двери (doorOpen)', snd1.doorOpen > snd0.doorOpen, JSON.stringify({ was: snd0.doorOpen, now: snd1.doorOpen }));
    await page.waitForTimeout(500);
    await page.screenshot({ path: out + 'obsh-3-door-open.png' });
    // смотрим на неё 13 с (держится 6–10 с, потом закрылась бы за 1.4 с) — должна стоять
    const seen = await st(page);
    ok('B на дверь смотрят (взгляд сквозь проём)', seen.seenDoors.includes(door.id), JSON.stringify(seen.seenDoors));
    // отойти из зоны хода полотна, продолжая смотреть
    await standAt(page, door.cor, door.x + door.nx * 1.0 + 1.4, door.y + door.ny * 1.0, door.x, door.y);
    let minOpen = 1;
    for (let k = 0; k < 26; k++) {
      await page.waitForTimeout(500);
      const s = await st(page);
      minOpen = Math.min(minOpen, s.doors[door.id] ?? 0);
    }
    ok('B пока смотрят — не закрывается (13 с)', minOpen > 0.5, `мин. открытость ${minOpen.toFixed(2)}`);
    await face(page, door.x, door.y, true);
    const b2 = await waitSt(page, (s) => !s.doors[door.id], 20000);
    ok('B отвернулся — закрылась сама', !b2.doors[door.id], JSON.stringify(b2.doors));
    const snd2 = await sound(page);
    ok('B звук: дверь закрылась (doorClose)', snd2.doorClose > snd1.doorClose, JSON.stringify({ was: snd1.doorClose, now: snd2.doorClose }));
    // снова открыть и войти в комнату — открытая пускает
    await standAt(page, door.cor, mx, my, door.x, door.y);
    await page.waitForTimeout(300);
    await pressE(page);
    await waitSt(page, (s) => (s.doors[door.id] ?? 0) >= 0.99, 6000);
    const inside = await walkTo(page, door.x - door.nx * 1.3, door.y - door.ny * 1.3, 90);
    ok('B распахнутая дверь пускает в комнату', inside.room === door.room, JSON.stringify(inside));
    await standAt(page, door.cor, mx + 1.4, my, door.x, door.y);
    await face(page, door.x, door.y, true);
    await waitSt(page, (s) => !s.doors[door.id], 20000);
    await face(page, door.x, door.y);
    await page.waitForTimeout(800);
    await page.screenshot({ path: out + 'obsh-4-door-closed-again.png' });
    if (door.dead) {
      const d = door.dead;
      await standAt(page, d.cor, d.x + d.nx * 1.0, d.y + d.ny * 1.0, d.x, d.y);
      await page.waitForTimeout(800);
      await pressE(page);
      await page.waitForTimeout(600);
      const flash = await page.evaluate(() => document.querySelector('.v3-flash')?.textContent ?? '');
      const s = await st(page);
      ok('B запертая дверь: E — «Заперто», не открылась', /Заперто/.test(flash) && !s.doors[d.id], flash);
    }
  }

  // ═════════════════ C: лампа у вахтёра ═════════════════
  const lamp = await page.evaluate(() => {
    const nav = window.__rfObshaga.nav();
    const s = window.__rfWalk;
    const l = nav.lamps.find((x) => s.rx.instances.find((i) => i.id === x.inst)?.roomTags.includes('вахтёрская')) ?? nav.lamps[0];
    return l ?? null;
  });
  ok('C лампа на споте (комната вахтёра)', !!lamp, JSON.stringify(lamp));
  if (lamp) {
    const r = await page.evaluate((inst) => window.__rfObshaga.nav().rooms.get(inst), lamp.inst);
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const dx = cx - lamp.x, dy = cy - lamp.y, l = Math.hypot(dx, dy) || 1;
    await standAt(page, lamp.inst, lamp.x + (dx / l) * 0.8, lamp.y + (dy / l) * 0.8, lamp.x, lamp.y);
    await page.evaluate(() => (window.__rf3d.fps.rotation.x = 0.6));
    await page.waitForTimeout(1200);
    const c0 = await st(page);
    ok('C у лампы — «E — взять керосиновую лампу»', c0.nearLamp === `${lamp.inst}/${lamp.spot}` && /лампу/.test(c0.prompt ?? ''), JSON.stringify({ near: c0.nearLamp, prompt: c0.prompt }));
    const model0 = await page.evaluate((inst) => window.__rf3d.scene.meshes.some((m) => m.name === `propModel:${inst}:p_obsh_lantern` && m.isEnabled()), lamp.inst);
    await page.screenshot({ path: out + 'obsh-5-lamp-on-floor.png' });
    await pressE(page);
    const c1 = await waitSt(page, (s) => s.holding, 5000);
    await page.waitForTimeout(1200);
    const after = await page.evaluate(({ inst, spot }) => ({
      taken: window.__rfWalk.world.lampTaken(inst, spot),
      model: window.__rf3d.scene.meshes.some((m) => m.name === `propModel:${inst}:p_obsh_lantern` && m.isEnabled()),
      held: window.__rf3d.scene.meshes.some((m) => m.name === 'obsh:heldLanternModel' && m.isEnabled()),
      light: window.__rf3d.scene.lights.find((l) => l.name === 'obsh:lantern')?.isEnabled() ?? false,
      saved: JSON.stringify(window.__rfWalk.world.save().world?.lamps ?? []),
    }), lamp);
    ok('C E — лампа в руке: спот пуст, модель у камеры, жёлтый свет, в сохранении мира', c1.holding && model0 && after.taken && !after.model && after.held && after.light && after.saved.includes(lamp.spot), JSON.stringify({ model0, ...after }));
    await page.evaluate(() => (window.__rf3d.fps.rotation.x = 0.04));
    await page.waitForTimeout(400);
    await page.screenshot({ path: out + 'obsh-6-lamp-in-hand.png' });
    const again = await page.evaluate(({ inst, spot }) => window.__rfWalk.request({ k: 'lamp', inst, spot }), lamp);
    ok('C ту же лампу второй раз не взять (операция мира → null)', again === null, String(again));
    await page.evaluate(() => window.__rfObshaga.giveLantern(false));
  }

  // ═════════════════ D: отключение и рука ═════════════════
  // в коридор у вестибюля, подальше от дверей
  spot = await page.evaluate(() => {
    const nav = window.__rfObshaga.nav();
    const s = window.__rfWalk;
    const hub = s.world.startId;
    const cor = nav.rooms.get(hub).edges.map((e) => nav.rooms.get(e.to)).find((r) => s.rx.instances.find((i) => i.id === r.id)?.roomTags.includes('коридор') && r.edges.length >= 2);
    if (!cor) return null;
    return { room: cor.id, x: (cor.x0 + cor.x1) / 2, y: (cor.y0 + cor.y1) / 2, w: cor.x1 - cor.x0, h: cor.y1 - cor.y0, hub };
  });
  ok('D коридор у вестибюля', !!spot, JSON.stringify(spot));
  if (spot) {
    await standAt(page, spot.room, spot.x, spot.y, spot.x + (spot.w > spot.h ? 5 : 0), spot.y + (spot.w > spot.h ? 0 : 5));
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__rfObshaga.forceBlackout(false));
    const d0 = await waitSt(page, (s) => s.phase === 'flicker', 3000);
    ok('D свет моргает', d0.phase === 'flicker', d0.phase);
    const d1 = await waitSt(page, (s) => s.phase === 'dark', 8000);
    await page.waitForTimeout(600);
    const dark = await page.evaluate(() => window.__rf3d.scene.lights.find((l) => l.name === 'hemi').intensity);
    ok('D свет погас: темно (hemi ≈ 0.03)', d1.phase === 'dark' && d1.level === 0 && dark < 0.06, `hemi ${dark}`);
    const sndD = await sound(page);
    ok('D звук: моргание и обрыв (flickerTick, blackout)', sndD.flicker > 0 && sndD.blackout > 0, JSON.stringify({ flicker: sndD.flicker, blackout: sndD.blackout }));
    await page.screenshot({ path: out + 'obsh-7-dark.png' });
    await page.evaluate(() => window.__rfObshaga.giveLantern(true));
    await page.waitForTimeout(800);
    await page.screenshot({ path: out + 'obsh-8-dark-lantern.png' });
    await page.evaluate(() => window.__rfObshaga.giveLantern(false));
    const sndH0 = await sound(page);
    const hd = await page.evaluate(() => window.__rfObshaga.spawnHandNear());
    ok('D рука вылезла из невидимой двери', !!hd, String(hd));
    const h0 = await st(page);
    const doorPt = await page.evaluate((id) => window.__rfObshaga.nav().doorById.get(id), hd);
    // спиной к двери руки: ползёт
    if (doorPt) await face(page, doorPt.x, doorPt.y, true);
    await page.waitForTimeout(3500);
    const h1 = await st(page);
    ok('D не видят (темно, спиной) — рука ползёт', h1.hand && h1.hand.length > (h0.hand?.length ?? 0) + 0.5 && !h1.hand.frozen, JSON.stringify({ l0: h0.hand?.length, l1: h1.hand?.length, phase: h1.hand?.phase }));
    const sndH1 = await sound(page);
    ok('D рука беззвучна: её дверь открылась без скрипа', sndH1.doorOpen === sndH0.doorOpen && h1.doors[hd] > 0, JSON.stringify({ before: sndH0.doorOpen, after: sndH1.doorOpen, open: h1.doors[hd] }));
    // рука — во весь проход: сквозь неё не пройти (коллайдеры)
    const arm = (await st(page)).handColliders;
    ok('D у руки коллайдеры (занимает проход)', arm > 0, `коллайдеров ${arm}`);
    await page.screenshot({ path: out + 'obsh-8b-hand-dark-back.png' });
    // с лампой лицом к руке: видна (свет лампы) — замерла; рука дальше поля
    await page.evaluate(() => window.__rfObshaga.giveLantern(true));
    const tip = h1.hand.tip;
    await face(page, tip.x, tip.y);
    await page.waitForTimeout(1500);
    const h2 = await st(page);
    await page.waitForTimeout(1500);
    const h3 = await st(page);
    const dist = await page.evaluate(({ x, y }) => Math.hypot(window.__rf3d.fps.position.x - x, -window.__rf3d.fps.position.z - y), h3.hand.tip);
    ok('D с лампой лицом к руке: видит её, рука не ближе поля и не ползёт к нему (замерла или уползает)', h2.seesHand && h3.hand && h3.hand.length <= h2.hand.length + 0.05 && dist > 2.9, JSON.stringify({ sees: h2.seesHand, frozen: h3.hand?.frozen, l2: h2.hand?.length, l3: h3.hand?.length, dist: +dist.toFixed(2), phase: h3.hand?.phase }));
    await page.screenshot({ path: out + 'obsh-9-hand-lantern.png' });
    // идём на руку с лампой — уползает
    await page.evaluate(async ({ x, y }) => {
      const c = window.__rf3d.fps;
      const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      for (let k = 0; k < 90; k++) {
        const dx = x - c.position.x, dz = -y - c.position.z, d = Math.hypot(dx, dz);
        if (d < 0.5) break;
        c.cameraDirection.set((dx / d) * 0.04, 0, (dz / d) * 0.04);
        c.rotation.y = Math.atan2(dx, dz);
        await frame();
      }
    }, tip);
    const h4 = await waitSt(page, (s) => !s.hand || s.hand.phase === 'retreating' || s.hand.length < h3.hand.length - 1, 6000);
    ok('D идём на руку с лампой — она уползает в свою дверь', !h4.hand || h4.hand.phase === 'retreating' || h4.hand.length < h3.hand.length - 1, JSON.stringify(h4.hand));
    await page.screenshot({ path: out + 'obsh-10-hand-retreat.png' });
    await page.evaluate(() => window.__rfObshaga.lightsBack());
    const h5 = await waitSt(page, (s) => s.phase !== 'dark', 4000);
    await page.waitForTimeout(1500);
    const h6 = await st(page);
    ok('D свет вернулся — руки нет', h5.phase !== 'dark' && !h6.hand, JSON.stringify({ phase: h6.phase, hand: h6.hand }));
    await page.screenshot({ path: out + 'obsh-11-lights-back.png' });

    // ═════════════════ E: без лампы рука хватает ═════════════════
    await page.evaluate(() => window.__rfObshaga.giveLantern(false));
    await standAt(page, spot.room, spot.x, spot.y, spot.x + 1, spot.y);
    await page.waitForTimeout(600);
    const hd2 = await page.evaluate(() => window.__rfObshaga.spawnHandNear());
    ok('E рука снова (темно)', !!hd2, String(hd2));
    const dp2 = await page.evaluate((id) => window.__rfObshaga.nav().doorById.get(id), hd2);
    if (dp2) await face(page, dp2.x, dp2.y, true);
    let grabbed = null;
    for (let k = 0; k < 120 && !grabbed; k++) {
      await page.waitForTimeout(400);
      const s = await st(page);
      if (s.dragging || s.dead) grabbed = s;
    }
    ok('E невидимая подползла и схватила — волочение', !!grabbed, JSON.stringify(grabbed && { dragging: grabbed.dragging, hand: grabbed.hand?.phase }));
    if (grabbed?.dragging) {
      await page.waitForTimeout(300);
      await page.screenshot({ path: out + 'obsh-12-dragged.png' });
    }
    const e1 = await waitSt(page, (s) => s.dead, 20000);
    await page.waitForSelector('.v3-obsh-dead', { timeout: 5000 }).catch(() => {});
    const panel = await page.evaluate(() => document.querySelector('.v3-obsh-dead')?.textContent ?? '');
    ok('E утащила за дверь: смерть, «Тебя утащили за дверь», «Ещё раз»', e1.dead && /Тебя утащили за дверь/.test(panel) && /Ещё раз/.test(panel), panel.slice(0, 80));
    const sndE = await sound(page);
    ok('E звук: хватка, волочение, смерть', sndE.grab > 0 && sndE.drag > 0 && sndE.death > 0, JSON.stringify({ grab: sndE.grab, drag: sndE.drag, death: sndE.death }));
    await page.waitForTimeout(1400);
    await page.screenshot({ path: out + 'obsh-13-dead.png' });
    await page.getByRole('button', { name: 'Ещё раз' }).click();
    await page.waitForTimeout(1500);
    const e2 = await st(page);
    const hubNow = await page.evaluate(() => {
      const d = window.__rf3dFold;
      const room = d.portal?.current ?? d.current.center;
      return window.__rfWalk.rx.instances.find((i) => i.id === room)?.roomId;
    });
    ok('E «Ещё раз» — жив, в вестибюле с вахтой', !e2.dead && !e2.dragging && hubNow === 'obsh_hub_vahta', JSON.stringify({ dead: e2.dead, room: hubNow }));
    await page.screenshot({ path: out + 'obsh-14-respawn.png' });
    await page.evaluate(() => window.__rfObshaga.lightsBack());
  }

  // ═════════════════ F: затопленный подвал (если вырос рядом) ═════════════════
  const wet = await page.evaluate(() => {
    const nav = window.__rfObshaga.nav();
    for (const r of nav.rooms.values()) if (r.flooded) return { id: r.id, x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2, z: r.z };
    return null;
  });
  if (wet) {
    await standAt(page, wet.id, wet.x, wet.y, wet.x + 3, wet.y);
    await page.evaluate(() => (window.__rf3d.fps.rotation.x = 0.45));
    await page.waitForTimeout(2000);
    const w = await page.evaluate((id) => !!window.__rf3d.scene.getMeshByName(`obsh:water:${id}`), wet.id);
    ok('F затопленный подвал: вода по пояс', w, JSON.stringify(wet));
    await page.screenshot({ path: out + 'obsh-15-water.png' });
    // шаг в воде (кадрами, как от клавиш) — медленнее, чем в сухом коридоре
    const stepLen = () =>
      page.evaluate(async () => {
        const c = window.__rf3d.fps;
        const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
        await frame();
        const x0 = c.position.x, z0 = c.position.z;
        const fx = Math.sin(c.rotation.y), fz = Math.cos(c.rotation.y);
        for (let k = 0; k < 10; k++) {
          c.cameraDirection.set(fx * 0.02, 0, fz * 0.02);
          await frame();
        }
        c.cameraDirection.setAll(0);
        await frame();
        return Math.hypot(c.position.x - x0, c.position.z - z0);
      });
    const wetR = await page.evaluate((id) => window.__rfObshaga.nav().rooms.get(id), wet.id);
    const along = wetR.x1 - wetR.x0 >= wetR.y1 - wetR.y0;
    const wx0 = along ? wetR.x0 + 0.6 : wet.x, wy0 = along ? wet.y : wetR.y0 + 0.6;
    await standAt(page, wet.id, wx0, wy0, along ? wx0 + 5 : wx0, along ? wy0 : wy0 + 5);
    await page.waitForTimeout(500);
    const inWater = await stepLen();
    await standAt(page, spot?.room ?? wet.id, spot?.x ?? 0, spot?.y ?? 0, (spot?.x ?? 0) + 5, spot?.y ?? 0);
    await page.waitForTimeout(500);
    const dry = await stepLen();
    ok('F в воде шаг медленнее (×0.55)', dry > 0.05 && Math.abs(inWater / dry - 0.55) < 0.12, `сухо ${dry.toFixed(3)} м, в воде ${inWater.toFixed(3)} м, ×${(inWater / dry).toFixed(2)}`);
  } else console.log('—   F затопленного подвала рядом не выросло — пропуск');

  // ═════════════════ H: встреча с рукой при обычной ходьбе ═════════════════
  await stageH(page);

  // ═════════════════ G: кооп ═════════════════
  // одна вкладка рендера меньше — двум игрокам (swiftshader) нужен процессор
  await page.close();
  if (!process.argv.includes('--no-coop')) await coopStage();
} catch (e) {
  if (e !== 'coop-only') ok('без исключений', false, String(e?.stack ?? e));
} finally {
  ok('нет ошибок страницы', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  stopServer();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} OK`);
  process.exit(bad.length ? 1 : 0);
}
