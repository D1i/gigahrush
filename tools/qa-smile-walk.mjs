// QA «Улыбки» (моб общаги) в «Прогулке» — в браузере, как игрок (tmp/smile-wip/CONTRACT.md §9.2):
//  1  стадия 1: избранный (фонарь в руке) в коридоре, она выглядывает из двери жилой комнаты — видна ему (скриншот);
//     посмотрел — прячется за косяк;
//  2  стадия 2: выглядывает ближе, смотрит на него; держит её в прицеле stareS — лицо рвётся (скриншот);
//  3  стадия 3: стоит посреди прохода впереди (скриншот); пошёл на неё — бросок в упор (скриншот), еда, смерть —
//     панель «Она улыбнулась тебе» с объяснением (скриншот);
//  T  ловушка (в соло её не бывает — qa.trap()): в жилой комнате дверь закрывается, свет гаснет, красные зрачки
//     (скриншот), удушье — «Дверь закрылась за тобой» (скриншот);
//  W  окно: в жилой комнате лицо и ладони у стекла (скриншот).
//
//   node tools/qa-smile-walk.mjs [--keep-server] [--only=1,2,3,T,W]   (скриншоты — tmp/smile-wip/shots/walk-*.png)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5293;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('../tmp/smile-wip/shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const keep = process.argv.includes('--keep-server');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
const want = (k) => !only || only.has(k);
// своя конфигурация vite: без слежения, свой кэш оптимизатора (другие сессии держат свои dev-серверы). Без слежения
// сервер отдаёт модули, собранные при первом запросе, — прошлый прогон не должен остаться жить на порту (иначе проверка
// пойдёт по старому коду): процесс на порту — свой (наш конфиг) — снимается перед стартом и после.
const { execSync } = await import('node:child_process');
const killPort = () => {
  if (process.platform !== 'win32') return;
  try {
    const out = execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess); if ($p.CommandLine -like '*vite.walk.config*') { Stop-Process -Id $_.OwningProcess -Force; 'killed ' + $_.OwningProcess } }"`, { encoding: 'utf8' });
    if (out.trim()) console.log('…  ', out.trim());
  } catch {}
};
killPort();
const server = spawn(`npx vite --config tmp/smile-wip/vite.walk.config.ts --port ${PORT} --strictPort`, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
const stopServer = () => {
  if (keep) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' });
    else server.kill('SIGTERM');
  } catch {}
  killPort();
};
for (let k = 0; k < 240 && !/ready in|Local:/.test(serverLog); k++) await new Promise((r) => setTimeout(r, 500));
if (/already in use|EADDRINUSE/i.test(serverLog)) {
  console.log('порт занят чужим сервером — выход');
  process.exit(2);
}
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
      await page.goto(url, { timeout: 240000 });
      return;
    } catch (e) {
      if (k >= 4) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
};

const view = (page) => page.evaluate(() => window.__rfSmile.view());
const obshSt = (page) => page.evaluate(() => window.__rfObshaga.state());
/** Ждать условия на виде «Улыбки» (fn(v, me)), до ms. */
const waitV = async (page, fn, ms) => {
  const t0 = Date.now();
  let v = null, me = null;
  while (Date.now() - t0 < ms) {
    [v, me] = await page.evaluate(() => [window.__rfSmile.view(), window.__rfSmile.me()]);
    if (fn(v, me)) return v;
    await page.waitForTimeout(150);
  }
  return v;
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

/** Камера — на голову модели (или на точку плана с высотой), кадрами, ms. */
const lookAtHer = (page, ms) =>
  page.evaluate(async (ms) => {
    const c = window.__rf3d.fps;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const m = window.__rfSmile.model();
      const v = window.__rfSmile.view();
      let h = m?.head;
      if (!h && v?.p) h = [v.p.x, v.z + 1.5, -v.p.y];
      if (h) {
        const dx = h[0] - c.position.x, dy = h[1] - c.position.y, dz = h[2] - c.position.z;
        c.rotation.y = Math.atan2(dx, dz);
        c.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz));
      }
      await frame();
    }
  }, ms);

/** Идти кадрами к точке плана (как от клавиш: cameraDirection каждый кадр), пока stop() в странице не скажет. */
const walkTo = (page, tx, ty, frames, step, stopPhase) =>
  page.evaluate(
    async ({ tx, ty, frames, step, stopPhase }) => {
      const c = window.__rf3d.fps;
      const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      for (let k = 0; k < frames; k++) {
        const v = window.__rfSmile.view();
        if (stopPhase && v && stopPhase.includes(v.phase)) break;
        const dx = tx - c.position.x, dz = -ty - c.position.z, d = Math.hypot(dx, dz);
        if (d < 0.05) break;
        c.rotation.y = Math.atan2(dx, dz);
        c.rotation.x = 0.05;
        c.cameraDirection.set((dx / d) * Math.min(step, d), 0, (dz / d) * Math.min(step, d));
        await frame();
      }
      c.cameraDirection.setAll(0);
      await frame();
      const d = window.__rf3dFold;
      return { x: c.position.x, y: -c.position.z, room: d.portal?.current ?? d.current.center };
    },
    { tx, ty, frames, step, stopPhase },
  );

/** Место для выглядывания из двери: коридор у жилой комнаты, игрок вдоль коридора на distM от двери, лицом к ней. */
const doorPlace = (page, distM) =>
  page.evaluate((distM) => {
    const nav = window.__rfObshaga.nav();
    const s = window.__rfWalk;
    const hub = window.__rf3dFold.portal?.current ?? s.world.startId;
    const tags = (id) => s.rx.instances.find((i) => i.id === id)?.roomTags ?? [];
    const hops = new Map([[hub, 0]]);
    const q = [hub];
    for (let k = 0; k < q.length; k++) for (const e of nav.rooms.get(q[k]).edges) if (!hops.has(e.to)) (hops.set(e.to, hops.get(q[k]) + 1), q.push(e.to));
    const doors = nav.doors.filter((d) => d.room && hops.has(d.cor) && tags(d.cor).includes('коридор') && tags(d.room).includes('комната')).sort((a, b) => hops.get(a.cor) - hops.get(b.cor));
    const roomOf = (x, y) => [...nav.rooms.values()].find((r) => r.obsh && tags(r.id).includes('коридор') && x > r.x0 + 0.35 && x < r.x1 - 0.35 && y > r.y0 + 0.35 && y < r.y1 - 0.35)?.id ?? null;
    const res = [];
    for (const d of doors) {
      const tx = -d.ny, ty = d.nx;
      for (const sgn of [1, -1]) {
        for (const k of [distM, distM - 0.7, distM + 0.7]) {
          const x = d.x + d.nx * 0.9 + tx * sgn * k, y = d.y + d.ny * 0.9 + ty * sgn * k;
          const room = roomOf(x, y);
          if (room) res.push({ door: d.id, room, x, y, tx: d.x, ty: d.y, dz: d.z });
        }
      }
      if (res.length > 12) break;
    }
    return res;
  }, distM);

const shot = async (page, name) => {
  await page.screenshot({ path: out + name });
  console.log('    скриншот', name);
};
/** Крупно: вырезка кадра вокруг её головы (проекция головы модели на холст). */
const zoom = async (page, name, w = 360, h = 300) => {
  const r = await page.evaluate(() => {
    const m = window.__rfSmile.model();
    const v3 = window.__rf3d;
    if (!m?.head) return null;
    const scene = v3.scene;
    const V = v3.fps.position.constructor;
    const p = V.TransformCoordinates(new V(m.head[0], m.head[1], m.head[2]), scene.getTransformMatrix());
    const rect = scene.getEngine().getRenderingCanvas().getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, rect: { l: rect.left, t: rect.top, w: rect.width, h: rect.height } };
  });
  if (!r) return;
  const x = Math.max(r.rect.l, Math.min(r.rect.l + r.rect.w - w, r.x - w / 2));
  const y = Math.max(r.rect.t, Math.min(r.rect.t + r.rect.h - h, r.y - h * 0.4));
  await page.screenshot({ path: out + name, clip: { x, y, width: w, height: h } });
  console.log('    крупно', name);
};

// прогрев: vite собирает зависимости до проверки (504 Outdated Optimize Dep — ещё раз)
for (let k = 0; k < 5; k++) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let stale = false;
  page.on('response', (r) => r.status() === 504 && (stale = true));
  try {
    await go(page, BASE);
    await page.evaluate(() => localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-warm', clusters: true, biome: 'obshaga', on: true })));
    await page.reload({ timeout: 240000 });
    await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 180000 });
    await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rf3d?.props?.ready, null, { timeout: 240000 });
    await page.waitForTimeout(3000);
  } catch {
    stale = true;
  }
  await ctx.close();
  if (!stale) break;
  console.log('…   прогрев: vite пересобрал зависимости — ещё раз');
  await new Promise((r) => setTimeout(r, 4000));
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|AudioContext|autoplay|WebSocket/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
  await go(page, BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-smile-1', deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, biome: 'obshaga', on: true }));
    localStorage.setItem('room-forge/obshaga-sound', '1');
  });
  for (let k = 0; ; k++) {
    await page.reload({ timeout: 240000 });
    await page.waitForTimeout(1000);
    try {
      await page.evaluate(async () => {
        const { mutate } = await import('/src/model/store.ts');
        mutate((p) => Object.assign(p.world, { trAfter: 100000 }));
      });
      await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 90000 });
      await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rfObshaga && window.__rfSmile && window.__rfInv, null, { timeout: 180000 });
      break;
    } catch (e) {
      if (k >= 5) throw e;
      errors.length = 0;
      await page.waitForTimeout(8000);
    }
  }
  await page.waitForFunction(() => window.__rf3d.props.ready, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  // без естественных отключений и охот: только по команде QA; фонарь — в руке (избранный)
  await page.evaluate(() => {
    window.__rfObshaga.calm(true);
    window.__rfSmile.calm(true);
    window.__rfInv.inv.qaHold('it_flashlight', true);
    const S = window.__rfSmile.cfg();
    S.omenS = 1.2;
    S.cornerChance = 0;
    S.windowChance = 0;
    // жест — звук «Улыбки» (AudioContext) запускается
    window.dispatchEvent(new PointerEvent('pointerdown'));
  });
  await page.waitForTimeout(800);
  ok('старт: в общаге, фонарь в руке', (await obshSt(page)).on && (await page.evaluate(() => window.__rfInv.inv.held?.item)) === 'it_flashlight');

  const place = async (distM, label) => {
    const list = await doorPlace(page, distM);
    for (const p of list) {
      await standAt(page, p.room, p.x, p.y, p.tx, p.ty);
      await page.waitForTimeout(500);
      const c = (await page.evaluate(() => window.__rfSmile.spots())).find((x) => x.spot.id === 'door:' + p.door);
      if (c) {
        console.log(`    ${label}: дверь ${p.door}, путь ${c.pathM.toFixed(1)} м, комната ${p.room}`);
        return { ...p, pathM: c.pathM };
      }
    }
    return null;
  };

  // ═════════════════ 1: стадия 1 — выглядывает издалека, прячется от взгляда ═════════════════
  if (want('1')) {
    const p = await place(9, 'стадия 1');
    ok('1 есть место: коридор у жилой комнаты, дверь — кандидат выглядывания', !!p);
    if (p) {
      await page.evaluate((m) => {
        const S = window.__rfSmile.cfg();
        S.peek1DistM = [m - 0.4, m + 0.4];
        S.noticeS = 1e9; // для скриншота: не прятаться от взгляда
        window.__rfSmile.force(1);
      }, p.pathM);
      const v1 = await waitV(page, (v) => v?.phase === 'peek' && v.lean > 0.95, 40000);
      ok('1 выглянула из двери (стадия 1)', v1?.phase === 'peek' && v1.stage === 1 && v1.spot?.door === p.door, JSON.stringify({ phase: v1?.phase, stage: v1?.stage, spot: v1?.spot?.id }));
      await page.waitForTimeout(400);
      const m1 = await page.evaluate(() => window.__rfSmile.model());
      ok('1 модель видна избранному (в проходах комнат)', !!m1?.visible && m1.rooms.length > 0, JSON.stringify(m1));
      await shot(page, 'walk-1-peek.png');
      await zoom(page, 'walk-1-peek-zoom.png', 240, 200);
      // посмотрел — прячется
      await page.evaluate(() => (window.__rfSmile.cfg().noticeS = 0.15));
      await lookAtHer(page, 300);
      const me1 = await page.evaluate(() => window.__rfSmile.me());
      const v1b = await waitV(page, (v) => v?.phase === 'hide' || v?.phase === 'idle', 8000);
      ok('1 посмотрел — спряталась', v1b?.phase === 'hide' || v1b?.phase === 'idle', JSON.stringify({ phase: v1b?.phase, sees: me1.sees }));
      await page.waitForTimeout(600);
      await shot(page, 'walk-1-hidden.png');
    }
  }

  // ═════════════════ 2: стадия 2 — смотрит; держит в прицеле — лицо рвётся ═════════════════
  if (want('2') || want('3')) {
    const p = await place(6.5, 'стадия 2');
    ok('2 есть место у двери', !!p);
    if (p) {
      await page.evaluate((m) => {
        const S = window.__rfSmile.cfg();
        S.peek2DistM = [m - 0.4, m + 0.4];
        S.noticeS = 0.15;
        window.__rfSmile.force(2);
      }, p.pathM);
      const v2 = await waitV(page, (v) => v?.phase === 'peek' && v.lean > 0.6, 40000);
      ok('2 выглянула (стадия 2)', v2?.phase === 'peek' && v2.stage === 2, JSON.stringify({ phase: v2?.phase, stage: v2?.stage }));
      await lookAtHer(page, 900);
      const me2 = await page.evaluate(() => window.__rfSmile.me());
      ok('2 избранный видит её и держит в прицеле', me2.sees && me2.aim, JSON.stringify(me2));
      await shot(page, 'walk-2-peek.png');
      await zoom(page, 'walk-2-peek-zoom.png', 260, 220);
      // держать в прицеле — до разрыва
      const t0 = Date.now();
      let v2b = null;
      while (Date.now() - t0 < 60000) {
        await lookAtHer(page, 400);
        v2b = await view(page);
        if (v2b?.phase === 'tear' && v2b.torn > 0.95) break;
        if (v2b?.phase !== 'peek' && v2b?.phase !== 'tear') break;
      }
      ok('2 досмотрел — лицо порвалось', v2b?.phase === 'tear' && v2b.torn > 0.9, JSON.stringify({ phase: v2b?.phase, torn: v2b?.torn }));
      await lookAtHer(page, 200);
      await shot(page, 'walk-2-torn.png');
      await zoom(page, 'walk-2-torn-zoom.png', 260, 220);
    }
  }

  // ═════════════════ 3: стадия 3 — провокация, бросок, смерть ═════════════════
  if (want('3')) {
    await page.evaluate(() => {
      const S = window.__rfSmile.cfg();
      S.pounceS = 5; // скриншот броска (медленный рендер)
      S.eatS = 6;
    });
    // ушла сама (не побежал) → встала посреди прохода; не было стадии 2 — сразу со стадии 3
    let v3 = await waitV(page, (v) => v?.phase === 'provoke', 45000);
    if (v3?.phase !== 'provoke') {
      const p = await place(6, 'стадия 3');
      if (p) await standAt(page, p.room, p.x, p.y, p.x + (p.x - p.tx), p.y + (p.y - p.ty));
      await page.evaluate(() => window.__rfSmile.force(3));
      v3 = await waitV(page, (v) => v?.phase === 'provoke', 30000);
    }
    ok('3 встала посреди прохода впереди', v3?.phase === 'provoke' && !!v3.p, JSON.stringify({ phase: v3?.phase, p: v3?.p }));
    if (v3?.p) {
      await lookAtHer(page, 900);
      await shot(page, 'walk-3-provoke.png');
      await zoom(page, 'walk-3-provoke-zoom.png', 300, 360);
      const pos = await page.evaluate(() => {
        const c = window.__rf3d.fps.position;
        return { x: c.x, y: -c.z };
      });
      console.log('    до неё', Math.hypot(pos.x - v3.p.x, pos.y - v3.p.y).toFixed(2), 'м');
      await walkTo(page, v3.p.x, v3.p.y, 900, 0.035, ['pounce', 'eat']);
      const vp = await waitV(page, (v) => v?.phase === 'pounce' || v?.phase === 'eat', 8000);
      ok('3 подошёл ближе метра — бросок', vp?.phase === 'pounce' || vp?.phase === 'eat', JSON.stringify({ phase: vp?.phase, u: vp?.u }));
      await waitV(page, (v) => v?.phase !== 'pounce' || v.u > 0.6, 12000);
      await shot(page, 'walk-3-pounce.png');
      const ve = await waitV(page, (v) => v?.phase === 'eat' && v.u > 0.3, 15000);
      ok('3 ест', ve?.phase === 'eat');
      await shot(page, 'walk-3-eat.png');
      const dead = await page.waitForSelector('.v3-obsh-dead h2', { timeout: 40000 }).then(() => true, () => false);
      const title = dead ? await page.locator('.v3-obsh-dead h2').innerText() : null;
      const hint = dead ? await page.locator('.v3-obsh-dead .hint').innerText() : null;
      ok('3 смерть: «Она улыбнулась тебе» и подсказка правила', title === 'Она улыбнулась тебе' && /метра/.test(hint ?? ''), JSON.stringify({ title, hint }));
      await shot(page, 'walk-3-dead.png');
      await page.getByRole('button', { name: 'Ещё раз' }).click().catch(() => {});
      await page.waitForTimeout(1500);
      // горизонт — в момент рисования (эффекты кадра накладывают крен только на время отрисовки)
      const cam3 = await page.evaluate(
        () =>
          new Promise((res) => {
            const v3 = window.__rf3d, c = v3.fps;
            const o = v3.scene.onBeforeDrawPhaseObservable.addOnce(() => {
              res({ z: +c.rotation.z.toFixed(3), x: +c.rotation.x.toFixed(3), roll: v3.posture.roll, up: c.upVector.asArray().map((v) => +v.toFixed(3)), fx: window.__rfInv.fx(), frozen: v3.posture.frozen });
            });
            void o;
          }),
      );
      ok('3 «Ещё раз» — жив, горизонт ровный', !(await obshSt(page)).dead && Math.abs(cam3.z) < 0.02 && Math.abs(cam3.up[0]) < 0.02 && Math.abs(cam3.up[2]) < 0.02, JSON.stringify(cam3));
      await shot(page, 'walk-3-retry.png');
      const probe = await page.evaluate(async () => {
        const c = window.__rf3d.fps;
        const f0 = c.updateUpVectorFromRotation;
        c.updateUpVectorFromRotation = true;
        const f1 = c.updateUpVectorFromRotation;
        for (let k = 0; k < 3; k++) await new Promise((r) => requestAnimationFrame(() => r()));
        console.log('flags', f0, f1, c.updateUpVectorFromRotation, Object.getOwnPropertyDescriptor(c, 'updateUpVectorFromRotation'));
        const before = c.upVector.asArray().map((v) => +v.toFixed(3));
        c.getViewMatrix(true);
        return { f0, f1, flag: c.updateUpVectorFromRotation, desc: JSON.stringify(Object.getOwnPropertyDescriptor(c, 'updateUpVectorFromRotation') ?? null), rq: !!c.rotationQuaternion, parent: !!c.parent, before, after: c.upVector.asArray().map((v) => +v.toFixed(3)), rot: c.rotation.asArray().map((v) => +v.toFixed(3)), active: window.__rf3d.scene.activeCamera === c, cams: window.__rf3d.scene.activeCameras?.length ?? 0 };
      });
      console.log('    камера после «Ещё раз»', JSON.stringify(probe));
    }
    await page.evaluate(() => {
      const S = window.__rfSmile.cfg();
      S.pounceS = 0.45;
      S.eatS = 3.5;
    });
  }

  // ═════════════════ T: ловушка ═════════════════
  if (want('T')) {
    await page.evaluate(() => window.__rfSmile.calm(true));
    const room = await page.evaluate(() => {
      const nav = window.__rfObshaga.nav();
      const s = window.__rfWalk;
      const cur = window.__rf3dFold.portal?.current ?? s.world.startId;
      const tags = (id) => s.rx.instances.find((i) => i.id === id)?.roomTags ?? [];
      const hops = new Map([[cur, 0]]);
      const q = [cur];
      for (let k = 0; k < q.length; k++) for (const e of nav.rooms.get(q[k]).edges) if (!hops.has(e.to)) (hops.set(e.to, hops.get(q[k]) + 1), q.push(e.to));
      const d = nav.doors.filter((x) => x.room && hops.has(x.room) && tags(x.room).includes('комната') && !window.__rfObshaga.state().doors[x.id]).sort((a, b) => hops.get(a.room) - hops.get(b.room))[0];
      return d ? { door: d.id, room: d.room, x: d.x - d.nx * 1.6, y: d.y - d.ny * 1.6, tx: d.x, ty: d.y } : null;
    });
    ok('T есть жилая комната', !!room);
    if (room) {
      await page.evaluate((id) => window.__rfObshaga.openDoor(id), room.door);
      await page.waitForTimeout(1500);
      await standAt(page, room.room, room.x, room.y, room.tx, room.ty);
      await page.waitForTimeout(800);
      const okTrap = await page.evaluate(() => window.__rfSmile.trap());
      ok('T ловушка началась (внутри жилой комнаты)', okTrap);
      await page.waitForTimeout(1200);
      await shot(page, 'walk-T-closing.png');
      const locked = await page.evaluate((id) => window.__rfObshaga.state().prompt, room.door);
      const vt = await waitV(page, (v) => v?.trap?.ph === 'eyes' && v.trap.t > 1, 30000);
      const ds = await obshSt(page);
      ok('T дверь закрылась, свет погас, зрачки', vt?.trap?.ph === 'eyes' && (ds.doors[room.door] ?? 0) < 0.05, JSON.stringify({ ph: vt?.trap?.ph, door: ds.doors[room.door] ?? 0, prompt: locked }));
      // повернуться к зрачкам
      await page.evaluate(async () => {
        const c = window.__rf3d.fps;
        for (let k = 0; k < 40; k++) {
          c.rotation.y += 0.12;
          await new Promise((r) => requestAnimationFrame(() => r()));
        }
      });
      await shot(page, 'walk-T-eyes.png');
      // E у двери — заперто
      const dead = await page.waitForSelector('.v3-obsh-dead h2', { timeout: 40000 }).then(() => true, () => false);
      const title = dead ? await page.locator('.v3-obsh-dead h2').innerText() : null;
      const hint = dead ? await page.locator('.v3-obsh-dead .hint').innerText() : null;
      ok('T смерть: «Дверь закрылась за тобой» и подсказка правила', title === 'Дверь закрылась за тобой' && /фонарь/.test(hint ?? ''), JSON.stringify({ title, hint }));
      await shot(page, 'walk-T-dead.png');
      await page.getByRole('button', { name: 'Ещё раз' }).click().catch(() => {});
      await page.waitForTimeout(1500);
    }
  }

  // ═════════════════ W: окно ═════════════════
  if (want('W')) {
    const w = await page.evaluate(() => {
      const nav = window.__rfObshaga.nav();
      const s = window.__rfWalk;
      const tags = (id) => s.rx.instances.find((i) => i.id === id)?.roomTags ?? [];
      for (const r of nav.rooms.values()) {
        if (!tags(r.id).includes('комната')) continue;
        const p = r.props.find((x) => x.propId === 'p_obsh_window');
        if (!p) continue;
        const cx = (p.rect.x0 + p.rect.x1) / 2, cy = (p.rect.y0 + p.rect.y1) / 2;
        const horiz = p.rect.x1 - p.rect.x0 >= p.rect.y1 - p.rect.y0;
        const nx = horiz ? 0 : cx - r.x0 < r.x1 - cx ? 1 : -1, ny = horiz ? (cy - r.y0 < r.y1 - cy ? 1 : -1) : 0;
        return { room: r.id, x: cx + nx * 2.6 + 0.3, y: cy + ny * 2.6, tx: cx, ty: cy };
      }
      return null;
    });
    ok('W есть жилая комната с окном', !!w);
    if (w) {
      await standAt(page, w.room, w.x, w.y, w.tx, w.ty);
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        const S = window.__rfSmile.cfg();
        S.windowChance = 1;
        S.peek1DistM = [0.5, 8];
        S.approach1M = 1.5; // ближе — прячется; окно в 2.6 м
        S.noticeS = 1e9;
        window.__rfSmile.force(1);
      });
      const vw = await waitV(page, (v) => v?.phase === 'peek' && v.lean > 0.95, 30000);
      ok('W выглянула из окна', vw?.pose === 'window', JSON.stringify({ phase: vw?.phase, pose: vw?.pose, spot: vw?.spot?.id }));
      await lookAtHer(page, 600);
      await shot(page, 'walk-W-window.png');
      await page.evaluate(() => {
        const S = window.__rfSmile.cfg();
        S.windowChance = 0.15;
        S.noticeS = 0.15;
        S.approach1M = 3;
      });
    }
  }

  const audio = await page.evaluate(() => window.__rfSmile.audio());
  console.log('    звук', JSON.stringify(audio));
  ok('без ошибок страницы', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) {
  console.log('ОШИБКА', e?.stack ?? e);
  ok('прогон без исключений', false, String(e?.message ?? e).slice(0, 300));
} finally {
  await browser.close();
  stopServer();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} OK`);
  process.exit(bad.length ? 1 : 0);
}
