// QA «Прогулки» в браузере: биом старта, сарай и площадка-переход (docs/GENERATOR-4D.md §19).
//  A (сарай): прогулка со стартом в биоме «Сарай» — хаб сарая, HUD «Сарай», отделка досками, проходы растут при ходьбе;
//    гирлянды — модель (светится), свет сцены приглушён (Biome.dark), в хрущёвках — снова как был.
//  B (переключение): список «Биом» → «Хрущёвки» — мир хрущёвок; обратно «Сарай» — тот же сохранённый мир сарая.
//  C (площадка-переход): переход выпал → E у выхода → за дверью площадка подъезда, её двери — панели; шаг на площадку
//    в счёт не идёт; E у двери площадки → другой биом, счётчик с нуля.
//
//   node tools/qa-barn-walk.mjs [--keep-server]   (скриншоты — tools/qa/barn-*.png)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5219;
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

/** Камерой болванки — к точке (Babylon x, z), кадрами. */
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
      return { pos: [cam.position.x, cam.position.y, cam.position.z] };
    },
    { x, z, frames },
  );

/** Где игрок: комната, её квартира, счётчик, сводка. */
const where = (page) =>
  page.evaluate(() => {
    const d = window.__rf3dFold, w = window.__rfWalk.world;
    const room = d.portal?.current ?? d.current.center;
    const cl = w.clusterAt(room);
    return { room, roomId: w.run().instances.find((i) => i.id === room)?.roomId, cl: cl && { id: cl.id, biome: cl.biome?.id ?? null, rich: cl.rich }, tr: w.transitionState(), stats: w.stats(), n: w.run().instances.length };
  });

/** Закрытые выходы квартиры экземпляра inst (по умолчанию — игрока). */
const exitsOf = (page, inst = null) =>
  page.evaluate((inst) => {
    const s = window.__rfWalk, d = window.__rf3dFold, w = s.world;
    const room = inst ?? d.portal?.current ?? d.current.center;
    const cid = w.clusterAt(room)?.id;
    const res = [];
    for (const i of s.rx.instances) {
      if (w.clusterAt(i.id)?.id !== cid) continue;
      for (const k of i.connectors ?? []) if (k.exit) res.push({ inst: i.id, connector: k.id, state: w.doorState(i.id, k.id), len: k.len });
    }
    return res;
  }, inst);

/** Встать в комнате inst перед дверью-панелью connector (0.8 м, лицом к двери). */
const standAtDoor = async (page, inst, connector) => {
  await page.evaluate((id) => window.__rf3dFold.goTo(id), inst);
  await page.waitForTimeout(700);
  return page.evaluate(
    ({ inst, connector }) => {
      const d = window.__rf3dFold.deadEndAt(inst, connector);
      if (!d) return null;
      const c = window.__rf3d.fps;
      c.position.set(d.center.x + d.u.x * 0.8, d.center.y + 1.65, d.center.z + d.u.z * 0.8);
      c.rotation.set(0.05, Math.atan2(-d.u.x, -d.u.z), 0);
      c.cameraDirection.setAll(0);
      return { cx: d.center.x, cz: d.center.z, ux: d.u.x, uz: d.u.z };
    },
    { inst, connector },
  );
};

/** Новый мир: сид, биом старта, настройки мира (поверх проекта); weights — веса спец-комнат переходов. */
const setup = async (page, seed, biome, world = {}, specials = null) => {
  await go(page, BASE);
  await page.evaluate(({ seed, biome }) => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed, deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, biome, on: true }));
  }, { seed, biome });
  await page.reload({ timeout: 180000 });
  await page.waitForTimeout(1000);
  await page.evaluate(
    async ({ world, specials }) => {
      const { mutate } = await import('/src/model/store.ts');
      mutate((p) => {
        Object.assign(p.world, world);
        if (specials) for (const r of p.rooms) if (r.location && r.location.kind !== 'lair') r.gen.weight = specials.includes(r.location.kind) ? 1 : 0;
      });
    },
    { world, specials },
  );
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
};

const switchTo = async (page, biome) => {
  const before = await page.evaluate(() => window.__rfWalk?.key);
  await page.locator('.v3-walk-biome select').selectOption(biome);
  await page.waitForFunction((k) => window.__rfWalk && window.__rfWalk.key !== k && window.__rf3dFold?.portal?.isActive, before, { timeout: 180000 });
  await page.waitForTimeout(1500);
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock/i.test(m.text()) && errors.push(m.text().slice(0, 300)));

  // ═════════════════ A: сарай ═════════════════
  await setup(page, 'qa-barn', 'barn', { trAfter: 100000 });
  const a0 = await where(page);
  ok('A старт в сарае: хаб сарая, сеть ходов', a0.cl?.biome === 'barn' && /^barn_hub_/.test(a0.roomId), JSON.stringify(a0.cl) + ' ' + a0.roomId);
  ok('A HUD — «Сарай», в списке «Биом» — сарай', await page.evaluate(() => document.body.innerText.includes('Сарай') && document.querySelector('.v3-walk-biome select')?.value === 'barn'));
  const fin = await page.evaluate(() => {
    const s = window.__rfWalk;
    const run = s.world.run();
    return run.content.map((c) => [c.finish?.wall, c.finish?.floor]);
  });
  ok('A отделка — доски сарая', fin.length > 0 && fin.every(([wl, fl]) => /^f_barn_/.test(wl) && /^f_barn_/.test(fl)), JSON.stringify(fin.slice(0, 4)));
  const light = () => page.evaluate(() => {
    const sc = window.__rf3d.scene;
    return { hemi: sc.lights.find((l) => l.name === 'hemi')?.intensity, lamp: !!sc.lights.find((l) => l.name === 'mood:lamp') };
  });
  await page.waitForTimeout(800);
  const l0 = await light();
  ok('A в сарае темно: рассеянный свет приглушён, у игрока — тёплый свет', l0.hemi < 0.3 && l0.lamp, JSON.stringify(l0));
  const gar = await page.evaluate(() => ({
    model: !!window.__rf3d.props.get('p_barn_garland'),
    clones: window.__rf3d.scene.meshes.filter((m) => m.name.startsWith('propModel:') && m.name.endsWith(':p_barn_garland') && m.isEnabled()).length,
  }));
  ok('A гирлянды — модель из barn_props.glb, на сцене', gar.model && gar.clones > 0, JSON.stringify(gar));
  await page.screenshot({ path: out + 'barn-1-hub.png' });
  // по проходу: к ближайшему проходу хаба и дальше — сеть растёт
  const pass = await page.evaluate(() => {
    const s = window.__rfWalk, d = window.__rf3dFold;
    const room = d.portal?.current ?? d.current.center;
    const inst = s.rx.instances.find((i) => i.id === room);
    const k = inst.connectors.find((c) => c.tag === 'barn' && c.linkedTo);
    return k ? { to: k.linkedTo.inst } : null;
  });
  ok('A у хаба есть проход в сеть', !!pass);
  if (pass) {
    await page.evaluate((id) => window.__rf3dFold.goTo(id), pass.to);
    await page.waitForTimeout(1500);
    const a1 = await where(page);
    ok('A в проходе: кусок сарая, мир вырос', /^barn_/.test(a1.roomId) && a1.n > a0.n, `${a1.roomId}, комнат ${a0.n} → ${a1.n}`);
    await page.screenshot({ path: out + 'barn-2-passage.png' });
  }
  const allBarn = await page.evaluate(() => window.__rfWalk.world.run().instances.every((i) => i.roomId.startsWith('barn_')));
  ok('A все комнаты мира — сарай', allBarn);

  // ═════════════════ B: переключение биома ═════════════════
  const barnKey = await page.evaluate(() => window.__rfWalk.key);
  const barnStart = a0.room;
  await switchTo(page, 'khrush');
  const b0 = await where(page);
  ok('B «Биом» → «Хрущёвки»: мир хрущёвок, свой ключ сохранения', b0.cl?.biome === 'khrush' && (await page.evaluate(() => window.__rfWalk.key)) !== barnKey, JSON.stringify(b0.cl));
  const l1 = await light();
  ok('B в хрущёвках свет как был', l1.hemi > 0.8 && !l1.lamp, JSON.stringify(l1));
  await page.screenshot({ path: out + 'barn-3-switch-khrush.png' });
  await switchTo(page, 'barn');
  const b1 = await where(page);
  const b1key = await page.evaluate(() => window.__rfWalk.key);
  ok('B обратно «Сарай»: тот же сохранённый мир', b1key === barnKey && b1.cl?.biome === 'barn' && b1.n >= a0.n && (await page.evaluate((id) => !!window.__rfWalk.world.run().instances.find((i) => i.id === id), barnStart)), `${b1key}, комнат ${b1.n}`);

  // ═════════════════ C: площадка-переход ═════════════════
  // спец-комнаты — как в проекте: площадка, которая за дверью не встала (предел обзора), уступает им (гарантия перехода)
  await setup(page, 'qa-landing-0', null, { trAfter: 0, trBase: 1, trStep: 0, trLanding: 1, trToBiome: 1, clusterExits: [3, 6] });
  const c0 = await where(page);
  await page.evaluate(() => {
    const s = window.__rfWalk;
    s.enter(s.world.startId);
  });
  const ex = (await exitsOf(page)).filter((e) => e.len >= 7);
  ok('C переход выпал, у квартиры есть широкий выход', (await where(page)).tr.pending && ex.length > 0, JSON.stringify((await where(page)).tr));
  const f0 = await standAtDoor(page, ex[0].inst, ex[0].connector);
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => !window.__rfWalk.world.transitionState().pending, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const c1 = await page.evaluate(({ door }) => {
    const s = window.__rfWalk, w = s.world, run = w.run();
    const l = run.links.find((x) => (x.a.inst === door.inst && x.a.connector === door.connector) || (x.b.inst === door.inst && x.b.connector === door.connector));
    const t = l ? (l.a.inst === door.inst ? l.b.inst : l.a.inst) : null;
    const inst = t && s.rx.instances.find((i) => i.id === t);
    return { t, roomId: inst?.roomId, loc: t ? w.locationOf(t) : 'нет', panels: inst ? inst.connectors.filter((k) => k.exit).length : 0, loose: !!l?.loose };
  }, { door: ex[0] });
  ok('C за дверью — лестничная площадка (без спец-локации), её двери — панели', !!c1.t && /^landing_/.test(c1.roomId ?? '') && c1.loc === null && c1.panels >= 2 && c1.loose, JSON.stringify(c1));
  await page.screenshot({ path: out + 'barn-4-landing-door.png' });
  await camWalk(page, f0.cx - f0.ux * 1.2, f0.cz - f0.uz * 1.2, 400);
  await page.waitForTimeout(800);
  const c2 = await where(page);
  ok('C шагнул на площадку — в счёт не идёт', c2.room === c1.t && c2.tr.count === 1, JSON.stringify({ room: c2.room, tr: c2.tr }));
  await page.screenshot({ path: out + 'barn-5-on-landing.png' });
  const lx = await exitsOf(page, c1.t);
  const f1 = lx.length ? await standAtDoor(page, lx[0].inst, lx[0].connector) : null;
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyE');
  await page.waitForFunction((n) => window.__rfWalk.world.stats().clusters > n, c2.stats.clusters, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  // E открывает ближайшую к игроку дверь-панель площадки (площадка маленькая — не обязательно ту, у которой встали)
  const c3 = await page.evaluate(({ doors }) => {
    const s = window.__rfWalk, w = s.world;
    const st = doors.map((e) => w.doorState(e.inst, e.connector));
    const k = doors[st.indexOf('linked')];
    const to = k ? s.rx.instances.find((i) => i.id === k.inst).connectors.find((c) => c.id === k.connector).linkedTo?.inst : null;
    return { to, biome: to ? w.clusterAt(to)?.biome?.id : null, tr: w.transitionState(), states: st };
  }, { doors: lx });
  ok('C E у двери площадки: другой биом, счётчик с нуля, остальные двери площадки исчезли', !!f1 && !!c3.to && c3.biome !== c0.cl?.biome && c3.tr.count === 0 && c3.tr.resets === 1 && c3.states.filter((x) => x === 'linked').length === 1 && c3.states.filter((x) => x === 'dead').length === lx.length - 1, JSON.stringify(c3));
  if (f1) await camWalk(page, f1.cx - f1.ux * 1.2, f1.cz - f1.uz * 1.2, 400);
  await page.waitForTimeout(800);
  await page.screenshot({ path: out + 'barn-6-after-landing.png' });
} catch (e) {
  ok('без исключений', false, String(e?.stack ?? e));
} finally {
  ok('нет ошибок страницы', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  stopServer();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} OK`);
  process.exit(bad.length ? 1 : 0);
}
