// QA режима квартир «Прогулки» (бесконечный мир, docs/GENERATOR-4D.md §16) и входа в спец-комнаты «Прогона»:
// playwright + системный Chrome, свой vite (порт 5218).
//  A (переход — лифт): старт-квартира с закрытыми выходами-панелями → у выхода «E — открыть дверь» → E: новая
//    квартира, остальные выходы старой исчезли (стены) → прошёл в неё → счётчик до переноса (trAfter = 3) → E у выхода:
//    за дверью лифт, прочие выходы на месте → шагнул в лифт → этаж 1, выход → квартира другого биома или богатая,
//    счётчик сброшен, HUD — биом → назад к стене прихода → снова лифт.
//  B (переход — лестница): переход за дверью → шаг в лестницу → выход вниз → другой биом, сброс.
//  C (пропуск): переход за одной дверью, игрок открыл другую — переход исчез (sealed, проёма нет).
//  D («Прогон»): шаг в комнату лифта/лестницы складчатого прогона — сцена локации; выход — обратно к двери.
// Скриншоты — tools/qa/world-*.png. node tools/qa-world-walk.mjs [--keep-server]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5218;
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

/** Текущая комната игрока, её квартира, счётчик, сводка. */
const where = (page) =>
  page.evaluate(() => {
    const d = window.__rf3dFold, w = window.__rfWalk.world;
    const room = d.portal?.current ?? d.current.center;
    const cl = w.clusterAt(room);
    return { room, cl: cl && { id: cl.id, biome: cl.biome?.id ?? null, rich: cl.rich, exits: cl.exits, rooms: cl.rooms }, tr: w.transitionState(), stats: w.stats() };
  });

/** Закрытые выходы квартиры игрока (по JSON болванки) с точкой перед панелью. */
const exitsHere = (page) =>
  page.evaluate(() => {
    const s = window.__rfWalk, d = window.__rf3dFold, w = s.world;
    const room = d.portal?.current ?? d.current.center;
    const cid = w.clusterAt(room)?.id;
    const res = [];
    for (const i of s.rx.instances) {
      if (w.clusterAt(i.id)?.id !== cid) continue;
      for (const k of i.connectors ?? []) {
        if (!k.exit) continue;
        res.push({ inst: i.id, connector: k.id, state: w.doorState(i.id, k.id), len: k.len });
      }
    }
    return res;
  });

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

const prompt = (page) => page.evaluate(() => [...document.querySelectorAll('.v3-lift-prompt')].map((e) => e.textContent).join(' | '));

/** Новый мир: сид, настройки мира и веса спец-комнат (kinds — какие переходы бывают). */
const setup = async (page, seed, world, kinds) => {
  await go(page, BASE);
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed, deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, on: true }));
  }, seed);
  await page.reload({ timeout: 180000 });
  await page.waitForTimeout(1000);
  await page.evaluate(
    async ({ world, kinds }) => {
      const { mutate } = await import('/src/model/store.ts');
      mutate((p) => {
        Object.assign(p.world, world);
        for (const r of p.rooms) if (r.location && r.location.kind !== 'lair') r.gen.weight = kinds.includes(r.location.kind) ? 1 : 0;
      });
      window.__rfLiftSpec = { boardChance: 0, boardFirst: false };
    },
    { world, kinds },
  );
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
};

/** Дожать счётчик до выпадения перехода: «войти» в непосещённые комнаты квартиры игрока (как будто прошёл). */
const forcePending = (page) =>
  page.evaluate(() => {
    const s = window.__rfWalk, w = s.world, d = window.__rf3dFold;
    const room = d.portal?.current ?? d.current.center;
    const cid = w.clusterAt(room).id;
    const log = [];
    for (const i of w.run().instances) {
      if (w.transitionState().pending) break;
      if (w.clusterAt(i.id)?.id !== cid) continue;
      const r = s.enter(i.id);
      if (r.counted) log.push(`${r.count}:${Math.round(r.chance * 100)}%${r.triggered ? '!' : ''}`);
    }
    return { log, tr: w.transitionState() };
  });

const TR = { trAfter: 3, trBase: 1, trStep: 0, clusterExits: [3, 6] };

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock/i.test(m.text()) && errors.push(m.text().slice(0, 300)));

  // ═════════════════ A: переход — лифт ═════════════════
  await setup(page, 'qa-world-a', TR, ['lift']);
  const w0 = await where(page);
  ok('A старт: режим квартир, одна квартира, биом «Хрущёвки»', !!w0.tr && w0.stats.clusters === 1 && w0.cl?.biome === 'khrush', JSON.stringify({ cl: w0.cl, tr: w0.tr }));
  const ex0 = await exitsHere(page);
  ok('A у квартиры 3–6 закрытых выходов (метки exit)', ex0.length >= 3 && ex0.length <= 6 && ex0.every((e) => e.state === 'exit') && ex0.length === w0.stats.exitsOpen, `${ex0.length}, stats ${w0.stats.exitsOpen}`);
  const hud0 = await page.evaluate(() => document.body.innerText.includes('Хрущёвки'));
  ok('A HUD — биом квартиры', hud0);
  const door0 = ex0[0];
  const f0 = await standAtDoor(page, door0.inst, door0.connector);
  ok('A выход — дверь-панель (deadEndAt)', !!f0, JSON.stringify(door0));
  await page.waitForTimeout(500);
  const p0 = await prompt(page);
  ok('A у выхода — «E — открыть дверь»', p0.includes('E — открыть дверь'), p0 || '—');
  await page.screenshot({ path: out + 'world-1-exit-door.png' });
  await page.keyboard.press('KeyE');
  await page.waitForFunction((c0) => window.__rfWalk.world.stats().clusters > c0, w0.stats.clusters, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const a1 = await page.evaluate(({ door0, ex0 }) => {
    const s = window.__rfWalk, w = s.world;
    const others = ex0.filter((e) => e.connector !== door0.connector || e.inst !== door0.inst);
    const inst = s.rx.instances.find((i) => i.id === door0.inst);
    const k = inst.connectors.find((c) => c.id === door0.connector);
    return {
      clusters: w.stats().clusters,
      opened: w.doorState(door0.inst, door0.connector),
      linkedTo: k.linkedTo,
      others: others.map((e) => w.doorState(e.inst, e.connector)),
      otherPanels: others.map((e) => !!window.__rf3dFold.deadEndAt(e.inst, e.connector)),
    };
  }, { door0, ex0 });
  ok('A E: за дверью новая квартира, дверь — проём', a1.clusters === 2 && a1.opened === 'linked' && !!a1.linkedTo, JSON.stringify(a1));
  ok('A остальные выходы старой квартиры исчезли (стены)', a1.others.every((x) => x === 'dead') && a1.otherPanels.every((x) => !x), JSON.stringify({ st: a1.others, panels: a1.otherPanels }));
  await page.screenshot({ path: out + 'world-2-door-opened.png' });
  // прошёл в новую квартиру
  await camWalk(page, f0.cx - f0.ux * 1.0, f0.cz - f0.uz * 1.0, 300);
  await page.waitForTimeout(800);
  const w1 = await where(page);
  ok('A прошёл в дверь — комната новой квартиры, счётчик вырос', w1.room === a1.linkedTo?.inst && w1.cl?.id === 1 && w1.tr.count >= 1, JSON.stringify({ room: w1.room, cl: w1.cl, tr: w1.tr }));
  // счётчик → переход
  const fp = await forcePending(page);
  ok('A после trAfter = 3 комнат шанс 100% — переход выпал', fp.tr.pending && fp.log.some((x) => x.endsWith('!')), fp.log.join(' '));
  const ex1 = await exitsHere(page);
  const door1 = ex1.find((e) => e.len >= 7) ?? ex1[0];
  const f1 = await standAtDoor(page, door1.inst, door1.connector);
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => !window.__rfWalk.world.transitionState().pending, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const a2 = await page.evaluate(({ door1 }) => {
    const s = window.__rfWalk, w = s.world;
    const run = w.run();
    const l = run.links.find((x) => (x.a.inst === door1.inst && x.a.connector === door1.connector) || (x.b.inst === door1.inst && x.b.connector === door1.connector));
    const t = l ? (l.a.inst === door1.inst ? l.b.inst : l.a.inst) : null;
    const cl = w.clusterAt(door1.inst);
    return { t, kind: t ? w.locationOf(t)?.kind : null, loose: !!l?.loose, exits: cl.exits, transition: cl.transition, pending: w.transitionState().pending };
  }, { door1 });
  ok('A E при выпавшем переходе: за дверью лифт (loose), прочие выходы на месте', a2.kind === 'lift' && a2.loose && a2.transition === a2.t && a2.exits === ex1.length - 1 && !a2.pending, JSON.stringify(a2));
  await page.screenshot({ path: out + 'world-3-transition-door.png' });
  const biomeBefore = w1.cl.biome;
  await camWalk(page, f1.cx - f1.ux * 1.0, f1.cz - f1.uz * 1.0, 400);
  await page.waitForFunction(() => window.__rfLift?.ready, null, { timeout: 180000 }).catch(() => {});
  const inLift = await page.evaluate(() => ({ ready: !!window.__rfLift?.ready, st: window.__rfLift?.qaState() }));
  ok('A шагнул в дверь — сцена лифта', inLift.ready && inLift.st.floor === 0, JSON.stringify({ variant: inLift.st?.variant, floors: inLift.st?.floors, lair: inLift.st?.lair }));
  if (inLift.ready) {
    await page.evaluate(LIFT_WALK);
    await page.evaluate(() => window.__rfLift.qaStart());
    await page.evaluate(() => window.__lw(0, 0));
    const st1 = await page.evaluate(() => window.__lride(1));
    const L = st1.lair;
    const side = L && L.floor === 1 && L.side === 'straight' ? 'right' : 'straight';
    await page.evaluate((sd) => (sd === 'straight' ? window.__lw(0, 6, 15) : window.__lw(-6.5, 0, 15)), side);
    await page.waitForFunction(() => !window.__rfLift && !window.__rf3d.hasOverlay, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const w2 = await where(page);
    const hud2 = await page.evaluate((name) => !!name && document.body.innerText.includes(name), w2.cl?.biome ? (await page.evaluate((id) => window.__rfWalk.world.settings.world.biomes.find((b) => b.id === id)?.name, w2.cl.biome)) : null);
    ok(
      'A вышел из лифта — квартира другого биома или богатая, счётчик сброшен',
      !!w2.cl && (w2.cl.rich || w2.cl.biome !== biomeBefore) && w2.tr.resets === 1 && !w2.tr.pending,
      JSON.stringify({ room: w2.room, cl: w2.cl, tr: w2.tr, было: biomeBefore }),
    );
    ok('A HUD показывает новый биом', hud2);
    await page.screenshot({ path: out + 'world-4-after-lift.png' });
    const de = await page.evaluate((room) => {
      const w = window.__rfWalk.world;
      const link = w.run().links.find((l) => l.kind === 'lift' && l.b.inst === room);
      const x = link && window.__rf3dFold.deadEndAt(room, link.b.connector);
      return x ? { x: x.center.x, z: x.center.z } : null;
    }, w2.room);
    ok('A стена прихода — панель и в режиме квартир (тупики — стены)', !!de);
    if (de) {
      await page.waitForTimeout(1600);
      await camWalk(page, de.x, de.z, 400);
      await page.waitForFunction(() => window.__rfLift?.ready, null, { timeout: 180000 }).catch(() => {});
      const back = await page.evaluate(() => window.__rfLift?.qaState());
      ok('A шагнул к стене прихода — снова лифт у этажа 1', !!back && back.floor === 1, JSON.stringify(back && { floor: back.floor }));
    }
  }

  // ═════════════════ B: переход — лестница ═════════════════
  await setup(page, 'qa-world-b', TR, ['stairwell']);
  const b0 = await where(page);
  await forcePending(page);
  const exB = await exitsHere(page);
  const doorB = exB.find((e) => e.len >= 7) ?? exB[0];
  const fB = await standAtDoor(page, doorB.inst, doorB.connector);
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => !window.__rfWalk.world.transitionState().pending, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const tB = await page.evaluate(({ doorB }) => {
    const w = window.__rfWalk.world;
    const l = w.run().links.find((x) => (x.a.inst === doorB.inst && x.a.connector === doorB.connector) || (x.b.inst === doorB.inst && x.b.connector === doorB.connector));
    const t = l ? (l.a.inst === doorB.inst ? l.b.inst : l.a.inst) : null;
    return { t, kind: t ? w.locationOf(t)?.kind : null };
  }, { doorB });
  ok('B за дверью — бесконечная лестница', tB.kind === 'stairwell', JSON.stringify(tB));
  await camWalk(page, fB.cx - fB.ux * 1.0, fB.cz - fB.uz * 1.0, 400);
  await page.waitForFunction(() => window.__rfStair?.ready, null, { timeout: 180000 }).catch(() => {});
  const inStair = await page.evaluate(() => !!window.__rfStair?.ready && window.__rf3d.hasOverlay);
  ok('B шагнул в дверь — сцена лестницы', inStair);
  await page.screenshot({ path: out + 'world-5-stairwell.png' });
  if (inStair) {
    await page.evaluate(() => window.__rfStair.exit('descend'));
    await page.waitForFunction(() => !window.__rf3d.hasOverlay, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const b2 = await where(page);
    ok(
      'B вышел вниз — квартира другого биома или богатая, счётчик сброшен',
      !!b2.cl && (b2.cl.rich || b2.cl.biome !== b0.cl.biome) && b2.tr.resets === 1 && b2.stats.descents === 1,
      JSON.stringify({ cl: b2.cl, tr: b2.tr, было: b0.cl.biome }),
    );
  }

  // ═════════════════ C: пропущенный переход исчезает ═════════════════
  await setup(page, 'qa-world-c', TR, ['lift', 'stairwell']);
  await forcePending(page);
  const exC = await exitsHere(page);
  const c1 = await page.evaluate((exC) => {
    const s = window.__rfWalk, w = s.world;
    const d1 = exC.find((e) => e.len >= 7) ?? exC[0];
    const t = s.openDoor(d1.inst, d1.connector);
    const d2 = exC.find((e) => e !== d1 && w.doorState(e.inst, e.connector) === 'exit');
    const n = d2 ? s.openDoor(d2.inst, d2.connector) : null;
    const link = w.run().links.find((l) => l.a.inst === t || l.b.inst === t);
    return { t, kind: w.locationOf(t)?.kind, n, sealed: !!link?.sealed, state: w.doorState(d1.inst, d1.connector), inRx: s.rx.links.some((l) => l.a.inst === t || l.b.inst === t), d1 };
  }, exC);
  await page.waitForTimeout(1200);
  const c2 = await page.evaluate(({ d1, t }) => {
    const piece = window.__rf3dFold.pieces?.get(d1.inst);
    return { portal: !!piece?.portals.some((p) => p.to === t) };
  }, c1);
  ok('C переход за первой дверью, игрок открыл вторую — переход исчез', !!c1.t && !!c1.kind && !!c1.n && c1.sealed && c1.state === 'dead' && !c1.inRx && !c2.portal, JSON.stringify({ ...c1, ...c2 }));

  // ═════════════════ D: «Прогон» — вход в спец-комнату ═════════════════
  await go(page, BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ timeout: 180000 });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForTimeout(800);
  const runInfo = await page.evaluate(async () => {
    const { generateFoldRun } = await import('/src/gen4d/fold.ts');
    const { getProject, mutate } = await import('/src/model/store.ts');
    const { setUI } = await import('/src/model/ui.ts');
    window.__rfLiftSpec = { boardChance: 0, boardFirst: false };
    mutate((p) => {
      for (const r of p.rooms) if (r.location && r.location.kind !== 'lair') r.gen.weight = 6;
    });
    for (let k = 0; k < 20; k++) {
      const run = generateFoldRun(getProject(), { seed: 'qa-run-loc-' + k, count: 40 });
      const locOf = (i) => getProject().rooms.find((r) => r.id === i.roomId)?.location;
      const loc = run.instances.find((i) => locOf(i) && locOf(i).kind !== 'lair');
      const l = loc && run.links.find((x) => (!x.kind || x.kind === 'door') && (x.a.inst === loc.id || x.b.inst === loc.id));
      if (!l) continue;
      setUI({ run });
      return { seed: 'qa-run-loc-' + k, loc: loc.id, kind: locOf(loc).kind, from: l.a.inst === loc.id ? l.b.inst : l.a.inst };
    }
    return null;
  });
  ok('D в складчатом прогоне есть лифт или лестница', !!runInfo, JSON.stringify(runInfo));
  if (runInfo) {
    await page.getByRole('button', { name: 'Прогон', exact: true }).click();
    await page.waitForFunction(() => window.__rf3dFold && window.__rf3d?.parts?.length > 0, null, { timeout: 60000 }).catch(() => {});
    await page.getByRole('button', { name: 'От первого лица', exact: true }).first().click();
    await page.waitForTimeout(1500);
    await page.evaluate((from) => window.__rf3dFold.goTo(from), runInfo.from);
    await page.waitForTimeout(1500);
    const door = await page.evaluate(({ from, loc }) => {
      const d = window.__rf3dFold;
      const piece = d.pieces?.get(from);
      const q = piece?.portals.find((p) => p.to === loc);
      if (q) return { cx: q.center.x, cz: q.center.z, ux: q.u.x, uz: q.u.z, render: d.render };
      return { render: d.render };
    }, runInfo);
    ok('D дверь соседней комнаты в спец-комнату (портальный рендер)', door.cx !== undefined, JSON.stringify(door));
    if (door.cx !== undefined) {
      await page.evaluate((d) => {
        const c = window.__rf3d.fps;
        c.position.set(d.cx - d.ux * 1.2, c.position.y, d.cz - d.uz * 1.2);
      }, door);
      await page.waitForTimeout(300);
      await camWalk(page, door.cx + door.ux * 1.0, door.cz + door.uz * 1.0, 400);
      const flag = runInfo.kind === 'lift' ? '__rfLift' : '__rfStair';
      await page.waitForFunction((f) => window[f]?.ready, flag, { timeout: 180000 }).catch(() => {});
      const inLoc = await page.evaluate((f) => !!window[f]?.ready && window.__rf3d.hasOverlay, flag);
      ok(`D «Прогон»: шагнул в дверь — сцена ${runInfo.kind === 'lift' ? 'лифта' : 'лестницы'}`, inLoc);
      await page.screenshot({ path: out + 'world-6-run-loc.png' });
      if (inLoc) {
        if (runInfo.kind === 'lift') {
          await page.evaluate(LIFT_WALK);
          await page.evaluate(() => window.__rfLift.qaStart());
          await page.evaluate(() => window.__lw(0, 0));
          const st1 = await page.evaluate(() => window.__lride(1));
          const L = st1.lair;
          const side = L && L.floor === 1 && L.side === 'straight' ? 'right' : 'straight';
          await page.evaluate((sd) => (sd === 'straight' ? window.__lw(0, 6, 15) : window.__lw(-6.5, 0, 15)), side);
        } else {
          await page.evaluate(() => window.__rfStair.exit('descend'));
        }
        await page.waitForFunction(() => !window.__rf3d.hasOverlay, null, { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(1500);
        const back = await page.evaluate(({ from, loc }) => {
          const d = window.__rf3dFold;
          const room = d.portal?.current ?? d.current.center;
          const piece = d.pieces?.get(from);
          const q = piece?.portals.find((p) => p.to === loc);
          const c = window.__rf3d.fps.position;
          return { room, overlay: window.__rf3d.hasOverlay, dist: q ? +Math.hypot(c.x - q.center.x, c.z - q.center.z).toFixed(2) : null, toast: document.body.innerText.includes('Прогулке') };
        }, runInfo);
        ok('D выход из локации — обратно у двери соседней комнаты, подсказка про «Прогулку»', !back.overlay && back.room === runInfo.from && back.dist !== null && back.dist < 1.3, JSON.stringify(back));
        await page.waitForTimeout(1500);
        const again = await page.evaluate(() => window.__rf3d.hasOverlay);
        ok('D у двери сцена сама не открылась снова', !again);
      }
    }
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
