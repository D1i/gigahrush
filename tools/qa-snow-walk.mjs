// QA «Прогулки» в снежных ходах и спец-локации «Ангар» (docs/GENERATOR-4D.md §20, docs/LOCATIONS.md §12):
//  A (старт): прогулка в биоме «Снежные тоннели» — берлога, оболочка снега вместо стен болванки, туман, низкий эллипсоид;
//  B (лаз): шаг в соседний лаз — глаз ползком (~0.5 м), идти вперёд по полости (коллизии со снегом), скриншоты;
//  C (обвал): порог обвала → треск → проём завален (пробка в оболочке, связь 'collapsed'); у места — засыпало, E ×12 —
//    откопался;
//  D (подтаявший снег): мир дорастает до подтаявшей берлоги, «E — бить» ×N → сцена ангара: падение, куча, выход
//    воротами → комната этажами ниже в другом биоме, поза — стоя.
//
//   node tools/qa-snow-walk.mjs [--keep-server]   (скриншоты — tools/qa/snow-*.png)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5330 + Math.floor(Math.random() * 40);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const keep = process.argv.includes('--keep-server');
// SNAP=1 — снимок сборки (NODE_ENV=development vite build --mode development --outDir tmp/qa-build): правки других
// сессий в дереве не перезагружают страницу посреди проверки
const SNAP = !!process.env.SNAP;
const server = spawn(SNAP ? `npx vite preview --outDir tmp/qa-build --port ${PORT} --strictPort` : `npx vite --port ${PORT} --strictPort`, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
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

const where = (page) =>
  page.evaluate(() => {
    const d = window.__rf3dFold, w = window.__rfWalk.world, c = window.__rf3d.fps;
    const room = d.portal?.current ?? d.current.center;
    const cl = w.clusterAt(room);
    const inst = window.__rfWalk.rx.instances.find((i) => i.id === room);
    return {
      room, roomId: inst?.roomId, tags: inst?.roomTags, biome: cl?.biome?.id ?? null, n: w.run().instances.length,
      cam: [c.position.x, c.position.y, c.position.z], ell: c.ellipsoid.y, off: c.ellipsoidOffset.y, speed: c.speed,
      fog: window.__rf3d.scene.fogMode, floor: w.run().instances.find((i) => i.id === room)?.floor ?? 0,
    };
  });

/** Камерой — к точке (Babylon x, z), кадрами (коллизии и гравитация — как у игрока). */
const camWalk = (page, x, z, frames = 300, step = 0.03) =>
  page.evaluate(
    async ({ x, z, frames, step }) => {
      const v = window.__rf3d;
      const cam = v.fps;
      const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      const p0 = cam.position.clone();
      for (let k = 0; k < frames && !v.hasOverlay; k++) {
        const dx = x - cam.position.x, dz = z - cam.position.z, d = Math.hypot(dx, dz);
        if (d < 0.06) break;
        cam.cameraDirection.set((dx / d) * Math.min(step, d), 0, (dz / d) * Math.min(step, d));
        cam.rotation.y = Math.atan2(dx, dz);
        await frame();
      }
      return { moved: Math.hypot(cam.position.x - p0.x, cam.position.z - p0.z), pos: [cam.position.x, cam.position.y, cam.position.z] };
    },
    { x, z, frames, step },
  );

/** Середина комнаты id (Babylon x, z) и её проёмы: середина на линии стены и куда соседи. */
const roomGeo = (page, id) =>
  page.evaluate((id) => {
    const i = window.__rfWalk.rx.instances.find((x) => x.id === id);
    const cm = window.__rfWalk.rx.cellM;
    const b = i.bbox;
    return {
      cx: ((b.x0 + b.x1) / 2) * cm, cz: -((b.y0 + b.y1) / 2) * cm,
      doors: i.connectors.map((k) => ({ id: k.id, x: ((k.line[0] + k.line[2]) / 2) * cm, z: -((k.line[1] + k.line[3]) / 2) * cm, to: k.linkedTo?.inst ?? null, cut: !!k.cut, collapsed: !!k.collapsed })),
    };
  }, id);

/** Повернуть камеру к точке (Babylon x, z) — для скриншота вдоль лаза. */
const lookAt = (page, x, z, pitch = 0.05) =>
  page.evaluate(({ x, z, pitch }) => {
    const c = window.__rf3d.fps;
    c.rotation.set(pitch, Math.atan2(x - c.position.x, z - c.position.z), 0);
  }, { x, z, pitch });

const frames = (page, n) => page.evaluate(async (n) => { for (let k = 0; k < n; k++) await new Promise((r) => requestAnimationFrame(() => r())); }, n);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock/i.test(m.text()) && errors.push(m.text().slice(0, 300)));

  // ═════════════════ A: старт в снегу ═════════════════
  await go(page, BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-snow', deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, biome: 'snow', on: true }));
  });
  await page.reload({ timeout: 180000 });
  await page.waitForTimeout(1000);
  // в снегу переходов по счётчику и так нет (свой выход); в снимке сборки модулей по путям нет
  if (!SNAP)
    await page.evaluate(async () => {
      const { mutate } = await import('/src/model/store.ts');
      mutate((p) => Object.assign(p.world, { trAfter: 100000 }));
    });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rfSnow, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  const a0 = await where(page);
  ok('A старт в снегу: берлога, биом snow', a0.biome === 'snow' && a0.tags?.includes('берлога'), `${a0.roomId} ${a0.biome}`);
  const shell = await page.evaluate((room) => {
    const sc = window.__rf3d.scene;
    const m = sc.getMeshByName(`snow:${room}:snow`);
    const col = sc.getMeshByName(`snow:${room}:snowcol`);
    return { shell: !!m && m.getTotalIndices() / 3, col: !!col && col.getTotalIndices() / 3 };
  }, a0.room);
  ok('A оболочка снега и коллайдер куска построены', shell.shell > 500 && shell.col > 100, JSON.stringify(shell));
  ok('A поза в снегу: низкий эллипсоид, туман, медленно', a0.ell < 0.35 && a0.fog === 3 && a0.speed < 0.15, `ell ${a0.ell} fog ${a0.fog} speed ${a0.speed}`);
  await page.screenshot({ path: out + 'snow-1-den.png' });
  // звук снега (в игре — первым нажатием клавиши / кликом)
  await page.evaluate(() => window.__rfSnow.audio.start());

  // ═════════════════ B: лаз ═════════════════
  const g0 = await roomGeo(page, a0.room);
  const exitDoor = g0.doors.find((d) => d.to);
  ok('B у берлоги есть лаз в сеть', !!exitDoor);
  let b0 = a0;
  if (exitDoor) {
    await camWalk(page, exitDoor.x, exitDoor.z, 600);
    const g1 = await roomGeo(page, exitDoor.to);
    await camWalk(page, g1.cx, g1.cz, 600);
    await frames(page, 30);
    b0 = await where(page);
    const eye = b0.cam[1] - (b0.floor ?? 0) * 0;
    ok('B ползком дошёл до соседнего куска (коллизии со снегом пускают)', b0.room === exitDoor.to || b0.n > a0.n, `${a0.room} → ${b0.room} (${b0.roomId})`);
    ok('B в лазе глаз низко (ползком)', !b0.tags?.includes('берлога') ? eye < 0.8 : eye < 1.3, `y глаза ${eye.toFixed(2)}, ${b0.roomId}`);
    await page.screenshot({ path: out + 'snow-2-crawl.png' });
  }
  // ещё вперёд — пара кусков
  for (let k = 0; k < 4; k++) {
    const w = await where(page);
    const g = await roomGeo(page, w.room);
    const d = g.doors.filter((x) => x.to && x.to !== a0.room).pop();
    if (!d) break;
    await camWalk(page, d.x, d.z, 500);
    const gn = await roomGeo(page, d.to);
    await camWalk(page, gn.cx, gn.cz, 500);
  }
  const b1 = await where(page);
  {
    const g = await roomGeo(page, b1.room);
    const d = g.doors.find((x) => x.to) ?? g.doors[0];
    if (d) await lookAt(page, d.x, d.z);
    await frames(page, 20);
  }
  const au1 = await page.evaluate(() => ({ running: window.__rfSnow.audio.running, ...window.__rfSnow.audio.counters }));
  ok('B звук: снег слышно, хруст ползком', au1.running && au1.crunch > 3, JSON.stringify(au1));
  // как игрок: зажатая W в лазе — на четвереньках (глаз ~0.5 м), руки в кадре, покачивание хода
  {
    await page.locator('canvas').first().click({ position: { x: 640, y: 400 } }).catch(() => {});
    await page.keyboard.down('KeyW');
    const rolls = [], eyes = [];
    for (let k = 0; k < 6; k++) {
      await page.waitForTimeout(300);
      rolls.push(await page.evaluate(() => window.__rf3d.fps.rotation.z));
      eyes.push(await page.evaluate(() => window.__rf3d.posture.eye));
    }
    const pose = await page.evaluate(() => ({
      base: window.__rfSnow.base, eye: window.__rfSnow.eye, tags: (() => { const d = window.__rf3dFold; const r = d.portal?.current ?? d.current.center; return window.__rfWalk.rx.instances.find((i) => i.id === r)?.roomTags; })(),
      hands: window.__rf3d.scene.getTransformNodeByName('snow:hands')?.isEnabled() ?? false,
    }));
    await page.screenshot({ path: out + 'snow-3b-crawl-hands.png' });
    await page.keyboard.up('KeyW');
    const den = pose.tags?.includes('берлога');
    // горизонт не кренится (заказчик: «горизонт ломается и заваливается»), ход — только толчок вверх-вниз
    ok('B зажатая W: на четвереньках (глаз ~0.5 м), руки в кадре, горизонт ровный, толчки хода', den || (pose.base < 0.6 && pose.hands && Math.max(...rolls.map(Math.abs)) < 1e-6 && Math.max(...eyes) - Math.min(...eyes) > 0.004), JSON.stringify({ ...pose, rolls: rolls.map((x) => +x.toFixed(3)), eyes: eyes.map((x) => +x.toFixed(3)) }));
  }
  // ползком «как на настоящем экране»: шаг 6 мм за кадр (60–144 к/с), маршрут через куски (горки, ямы, повороты)
  {
    const route = await page.evaluate(async () => {
      const v = window.__rf3d, c = v.fps, s = window.__rfWalk, d = window.__rf3dFold;
      const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      const cur = () => d.portal?.current ?? d.current.center;
      const visited = new Set([cur()]);
      const cm = s.rx.cellM;
      const passed = [];
      for (let n = 0; n < 8; n++) {
        const inst = s.rx.instances.find((i) => i.id === cur());
        const door = inst.connectors.find((k) => k.linkedTo && !visited.has(k.linkedTo.inst));
        if (!door) break;
        const out = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] }[door.side];
        const tx = ((door.line[0] + door.line[2]) / 2) * cm + out[0] * 0.6, tz = -((door.line[1] + door.line[3]) / 2) * cm + out[1] * 0.6;
        let ok = false, best = Infinity, since = 0;
        for (let f = 0; f < 700; f++) {
          const dx = tx - c.position.x, dz = tz - c.position.z, dd = Math.hypot(dx, dz);
          c.cameraDirection.set((dx / (dd || 1)) * 0.006, 0, (dz / (dd || 1)) * 0.006);
          c.rotation.y = Math.atan2(dx, dz);
          await frame();
          if (cur() === door.linkedTo.inst) { ok = true; break; }
          if (dd < best - 0.01) { best = dd; since = 0; } else if (++since > 150) break;
        }
        passed.push((ok ? '' : '✗') + s.rx.instances.find((i) => i.id === door.linkedTo.inst)?.roomId);
        if (!ok) break;
        visited.add(door.linkedTo.inst);
      }
      return { passed, pose: v.posture.pose };
    });
    ok('B ползком мелким шагом (6 мм/кадр) — сквозь куски, поза не сбивается', route.passed.length >= 5 && !route.passed.some((x) => x.startsWith('✗')) && route.pose === 'crawl', route.passed.join(' → ') + ' · ' + route.pose);
  }
  ok('B мир растёт по лазам — только снег', b1.n > a0.n && (await page.evaluate(() => window.__rfWalk.world.run().instances.every((i) => i.roomId.startsWith('snow_')))), `комнат ${a0.n} → ${b1.n}, сейчас ${b1.roomId}`);
  await page.screenshot({ path: out + 'snow-3-tunnel.png' });

  // ═════════════════ C: обвал ═════════════════
  // встать в лаз (не берлогу) у середины, и обвал — сейчас
  const tunnelId = await page.evaluate(() => {
    const s = window.__rfWalk;
    // длинный лаз (3–4 м): из его середины до проёмов дальше buryM — успеваешь
    const t = s.rx.instances.find((i) => /^snow_crawl_[34]/.test(i.roomId) && i.connectors.filter((k) => k.linkedTo).length >= 2);
    return t?.id ?? null;
  });
  ok('C есть длинный лаз с двумя связанными проёмами', !!tunnelId);
  if (tunnelId) {
    await page.evaluate((id) => window.__rf3dFold.goTo(id), tunnelId);
    await page.waitForTimeout(1200);
    const gt = await roomGeo(page, tunnelId);
    await page.evaluate(({ x, z }) => {
      const c = window.__rf3d.fps;
      c.position.x = x;
      c.position.z = z;
    }, { x: gt.cx, z: gt.cz });
    await frames(page, 20);
    await page.evaluate(() => {
      const s = window.__rfSnow.collapse;
      s.next = s.crawled;
    });
    // 'due' приходит при движении ползком: шаг на месте
    await page.evaluate(async () => {
      const cam = window.__rf3d.fps;
      for (let k = 0; k < 10; k++) {
        cam.cameraDirection.set(0.01, 0, 0);
        await new Promise((r) => requestAnimationFrame(() => r()));
      }
    });
    const c0 = await page.evaluate(() => ({ phase: window.__rfSnow.collapse.phase, site: window.__rfSnow.collapse.site }));
    ok('C треск: обвал начался у проёма', c0.phase === 'warn' && !!c0.site, JSON.stringify(c0));
    await page.screenshot({ path: out + 'snow-4-crack.png' });
    // уползти от места обвала — к другому проёму
    if (c0.site) {
      const far = gt.doors.filter((d) => d.to && d.id !== c0.site.connector).sort((a, b) => Math.hypot(b.x - c0.site.x, b.z + c0.site.y) - Math.hypot(a.x - c0.site.x, a.z + c0.site.y))[0];
      if (far) await camWalk(page, (far.x + gt.cx) / 2, (far.z + gt.cz) / 2, 200, 0.05);
    }
    await page.waitForFunction(() => window.__rfSnow.collapse.phase !== 'warn', null, { timeout: 20000 }).catch(() => {}); // треск 2 с — при низких к/с дольше
    await page.waitForTimeout(300);
    const c1 = await page.evaluate((site) => {
      const s = window.__rfWalk, w = s.world;
      const i = s.rx.instances.find((x) => x.id === site.inst);
      const k = i.connectors.find((x) => x.id === site.connector);
      return { state: w.doorState(site.inst, site.connector), flag: !!k?.collapsed, phase: window.__rfSnow.collapse.phase, chunks: window.__rf3d.scene.meshes.filter((m) => m.name.startsWith('snow:chunk')).length };
    }, c0.site);
    ok('C обвал: проём завален навсегда (collapsed), глыбы набора упали', c1.state === 'collapsed' && c1.flag && c1.chunks > 0, JSON.stringify(c1));
    ok('C успел уползти — не засыпан', c1.phase === 'calm', c1.phase);
    // раскопка завала: у пробки — «Завал. E — разгребать», 10 ударов — пробка на половину, 20 — лаз открыт, глыбы убраны
    {
      const gs = await roomGeo(page, c0.site.inst);
      const dp = gs.doors.find((d) => d.id === c0.site.connector);
      await page.evaluate(({ x, z, cx, cz }) => {
        const c = window.__rf3d.fps;
        const l = Math.hypot(cx - x, cz - z) || 1;
        c.position.x = x + ((cx - x) / l) * 0.7;
        c.position.z = z + ((cz - z) / l) * 0.7;
        c.rotation.y = Math.atan2(x - c.position.x, z - c.position.z);
      }, { x: dp.x, z: dp.z, cx: gs.cx, cz: gs.cz });
      await frames(page, 20);
      const pr0 = await page.evaluate(() => [...document.querySelectorAll('.v3-lift-prompt')].map((e) => e.textContent).join('|'));
      ok('C у завала: «Завал. E — разгребать (0/20)»', pr0.includes('Завал. E — разгребать (0/20)'), pr0);
      for (let k = 0; k < 10; k++) {
        await page.keyboard.press('KeyE');
        await frames(page, 2);
      }
      await frames(page, 20);
      const half = await page.evaluate((site) => {
        const s = window.__rfWalk;
        const k = s.rx.instances.find((i) => i.id === site.inst).connectors.find((x) => x.id === site.connector);
        return { p: s.world.collapseProgress(site.inst, site.connector), dug: k.dug ?? 0, state: s.world.doorState(site.inst, site.connector) };
      }, c0.site);
      await page.screenshot({ path: out + 'snow-5b-dig-half.png' });
      ok('C 10 ударов — раскопано наполовину, пробка меньше', Math.abs(half.p - 0.5) < 1e-6 && half.dug === 0.5 && half.state === 'collapsed', JSON.stringify(half));
      for (let k = 0; k < 10; k++) {
        await page.keyboard.press('KeyE');
        await frames(page, 2);
      }
      await frames(page, 40);
      const done = await page.evaluate((site) => {
        const s = window.__rfWalk;
        const k = s.rx.instances.find((i) => i.id === site.inst).connectors.find((x) => x.id === site.connector);
        return { state: s.world.doorState(site.inst, site.connector), linked: !!k.linkedTo, collapsed: !!k.collapsed, chunks: window.__rf3d.scene.meshes.filter((m) => m.name.startsWith('snow:chunk')).length };
      }, c0.site);
      await page.screenshot({ path: out + 'snow-5c-dug.png' });
      ok('C 20 ударов — лаз снова открыт, глыбы убраны', done.state === 'linked' && done.linked && !done.collapsed && done.chunks === 0, JSON.stringify(done));
    }
    const au2 = await page.evaluate(() => window.__rfSnow.audio.counters);
    ok('C звук: треск свода и удар обвала', au2.crack > 2 && au2.fall > 0, JSON.stringify(au2));
    await frames(page, 30);
    await page.screenshot({ path: out + 'snow-5-collapsed.png' });

    // засыпало: обвал у самого проёма — в другом лазе (здесь второй завал запер бы игрока — его не будет)
    const other = await page.evaluate((bad) => {
      const s = window.__rfWalk;
      const near = new Set([bad, ...s.rx.instances.find((i) => i.id === bad).connectors.map((k) => k.linkedTo?.inst).filter(Boolean)]);
      const t = s.rx.instances.find((i) => !near.has(i.id) && i.roomTags.includes('снег') && !i.roomTags.includes('берлога') && i.connectors.filter((k) => k.linkedTo).length >= 2);
      return t?.id ?? null;
    }, tunnelId);
    if (other) {
      await page.evaluate((id) => window.__rf3dFold.goTo(id), other);
      await page.waitForTimeout(1200);
    }
    const g2 = await roomGeo(page, other ?? (await where(page)).room);
    const near = g2.doors.find((d) => d.to);
    if (near) {
      await page.evaluate(({ x, z, cx, cz }) => {
        const c = window.__rf3d.fps;
        c.position.x = x + (cx - x) * 0.25;
        c.position.z = z + (cz - z) * 0.25;
      }, { x: near.x, z: near.z, cx: g2.cx, cz: g2.cz });
      await frames(page, 10);
      await page.evaluate(() => {
        const s = window.__rfSnow.collapse;
        s.next = s.crawled;
      });
      await page.evaluate(async () => {
        const cam = window.__rf3d.fps;
        for (let k = 0; k < 6; k++) {
          cam.cameraDirection.set(0.005, 0, 0);
          await new Promise((r) => requestAnimationFrame(() => r()));
        }
      });
      await page.waitForFunction(() => window.__rfSnow.collapse.phase !== 'warn', null, { timeout: 20000 }).catch(() => {}); // треск 2 с — при низких к/с дольше
    await page.waitForTimeout(300);
      const d0 = await page.evaluate(() => ({ phase: window.__rfSnow.collapse.phase, hud: document.body.innerText.includes('Засыпало'), white: !!document.querySelector('.v3-snow-buried') }));
      ok('C у проёма — засыпало: белая пелена, «E — откапываться»', d0.phase === 'buried' && d0.hud && d0.white, JSON.stringify(d0));
      await page.screenshot({ path: out + 'snow-6-buried.png' });
      for (let k = 0; k < 12; k++) await page.keyboard.press('KeyE');
      await frames(page, 10);
      const d1 = await page.evaluate(() => ({ phase: window.__rfSnow.collapse.phase, white: !!document.querySelector('.v3-snow-buried') }));
      ok('C E ×12 — откопался', d1.phase === 'calm' && !d1.white, JSON.stringify(d1));
      ok('C звук откопки', (await page.evaluate(() => window.__rfSnow.audio.counters.dig)) >= 12);
    }
  }

  // ═════════════════ D: подтаявший снег → ангар ═════════════════
  // дорастить мир (ползком вглубь) до подтаявшей берлоги
  const thaw = await page.evaluate(() => {
    const s = window.__rfWalk, w = s.world;
    const isThaw = (id) => w.locationOf(id)?.kind === 'hangar';
    const seen = new Set();
    const stack = [w.startId];
    for (let k = 0; k < 4000 && stack.length; k++) {
      const found = w.run().instances.find((i) => isThaw(i.id));
      if (found) return found.id;
      const id = stack[stack.length - 1];
      if (!seen.has(id)) {
        seen.add(id);
        w.expand(id);
      }
      const next = w.run().links.filter((l) => !l.kind && !l.sealed && (l.a.inst === id || l.b.inst === id)).map((l) => (l.a.inst === id ? l.b.inst : l.a.inst)).filter((x) => !seen.has(x));
      if (next.length) stack.push(next[next.length - 1]);
      else stack.pop();
    }
    return w.run().instances.find((i) => isThaw(i.id))?.id ?? null;
  });
  ok('D в сети есть подтаявшая берлога', !!thaw, thaw ?? '');
  if (thaw) {
    await page.waitForTimeout(800);
    await page.evaluate((id) => window.__rf3dFold.goTo(id), thaw);
    await page.waitForTimeout(1500);
    const gt = await roomGeo(page, thaw);
    await page.evaluate(({ x, z }) => {
      const c = window.__rf3d.fps;
      c.position.x = x + 0.5;
      c.position.z = z;
      c.rotation.set(0.9, -Math.PI / 2, 0);
    }, { x: gt.cx, z: gt.cz });
    await frames(page, 40);
    const p0 = await page.evaluate(() => ({ hud: [...document.querySelectorAll('.v3-lift-prompt')].map((e) => e.textContent).join('|'), patch: !!window.__rf3d.scene.meshes.find((m) => m.name.startsWith('snow:thaw:') && m.isEnabled()) }));
    ok('D у пятна: подсказка «Подтаявший снег. E — бить», пятно в полу', /Подтаявший снег/.test(p0.hud) && p0.patch, JSON.stringify(p0));
    await page.screenshot({ path: out + 'snow-7-thaw.png' });
    const need = await page.evaluate((id) => window.__rfWalk.world.locationOf(id).roll.hits, thaw);
    for (let k = 0; k < need - 1; k++) {
      await page.keyboard.press('KeyE');
      await frames(page, 5);
    }
    await page.screenshot({ path: out + 'snow-8-cracks.png' });
    await page.keyboard.press('KeyE');
    await frames(page, 5);
    console.log('   диагностика удара:', JSON.stringify(await page.evaluate((id) => ({ thaw: window.__rfSnow?.thaw?.get(id), overlay: window.__rf3d.hasOverlay, mode: window.__rf3d.mode, hud: [...document.querySelectorAll('.v3-lift-prompt')].map((e) => e.textContent) }), thaw)));
    await page.waitForFunction(() => !!window.__rfHangar?.ready, null, { timeout: 120000 }).catch(() => {});
    const h0 = await page.evaluate(() => window.__rfHangar?.qaState());
    ok('D пробил — сцена ангара, падение', !!h0 && h0.hud.phase === 'fall', JSON.stringify(h0?.hud));
    await page.waitForTimeout(900);
    await page.screenshot({ path: out + 'snow-9-fall.png' });
    await page.waitForFunction(() => window.__rfHangar?.qaState().hud.phase === 'walk', null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(300);
    const h1 = await page.evaluate(() => window.__rfHangar?.qaState());
    ok('D звук ангара: удар о кучу', (await page.evaluate(() => window.__rfHangar?.audio.counters.land ?? 0)) > 0);
    ok('D упал на кучу и встал', h1?.hud.phase === 'walk' && h1.eyeY > h1.heapTop + 1.2, JSON.stringify({ phase: h1?.hud.phase, eye: h1?.eyeY }));
    await page.screenshot({ path: out + 'snow-10-hangar.png' });
    // к воротам: зона мини-босса, выход
    await page.evaluate(() => {
      const s = window.__rfHangar;
      s.place(0, 9, 0, 0);
      s.advance(0.2);
    });
    const h2 = await page.evaluate(() => window.__rfHangar?.qaState());
    ok('D у тали — зона мини-босса, табличка', h2?.hud.boss && /мини-босс/.test(h2.hud.sign), h2?.hud.sign);
    await page.waitForTimeout(500);
    await page.screenshot({ path: out + 'snow-11-boss.png' });
    await page.evaluate(() => {
      const s = window.__rfHangar;
      s.advance(5, { f: 1, s: 0, run: true });
    });
    await page.waitForFunction(() => !window.__rfHangar && !window.__rf3d.hasOverlay, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const e0 = await where(page);
    ok('D ворота — комната этажами ниже, другой биом, поза стоя', e0.biome !== 'snow' && (e0.floor ?? 0) < 0 && e0.ell > 0.6, JSON.stringify({ room: e0.roomId, biome: e0.biome, floor: e0.floor, ell: e0.ell, fog: e0.fog }));
    await page.waitForTimeout(1500);
    const e1 = await page.evaluate(() => ({ pose: window.__rf3d.posture.pose, eye: +window.__rf3d.posture.eye.toFixed(2), roll: +window.__rf3d.fps.rotation.z.toFixed(3) }));
    ok('D за воротами — встал во весь рост, камера не наклонена', e1.pose === 'stand' && e1.eye > 1.4 && Math.abs(e1.roll) < 1e-3, JSON.stringify(e1));
    await page.screenshot({ path: out + 'snow-12-after.png' });
  }

  ok('ошибок в консоли нет', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) {
  ok('скрипт без исключений', false, String(e?.stack ?? e).slice(0, 600));
} finally {
  await browser.close();
  stopServer();
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} OK`);
  process.exit(fails.length ? 1 : 0);
}
