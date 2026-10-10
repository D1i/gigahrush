// QA «Прогулки» в браузере: биом «Катакомбы» — темнота, наводнение, дыхание, перелаз, лазы (docs/LOCATIONS.md,
// раздел «Катакомбы»; слой — src/view3d/catacombsWalk.ts, хуки — window.__rfCatacombs).
//  A (вход): старт в хабе катакомб, HUD «Катакомбы»; отделка f_cat_*; модели набора catacombs_props.glb загружены (не
//    болванки); темно — hemi 0, 'mood:lamp' погашен, туман катакомб; фонарь в руке горит; вода — лужи (0.06 м).
//  B (наводнение): force('rise') и ускорение часов — уровень растёт, вода видна, ход в воде медленнее; на полу хаба
//    голова под водой (муть), воздух кончается, тонет — «Захлебнулся» → «Ещё раз» → на сухой площадке (z ≥ 2.1), сухо,
//    пик пережидается на площадке живым; спад и штиль.
//  C (перелаз): ход с трубой поперёк — перед трубой «E — перелезть», E — дуга, игрок по ту сторону трубы стоя.
//  D (лаз): устье — у проёма лаза стоя «C — ползком в лаз»; стоя в лаз не пролезть; ползком — в лазе на четвереньках,
//    над головой низко.
//  E (кооп, --coop): два игрока в лобби, мир катакомб: часы ведёт хост (A), у B — срез fx 'flood': тот же уровень и
//    фаза, force у клиента — null; спад у хоста — у B тоже.
//
//   node tools/qa-catacombs-walk.mjs [--coop] [--keep-server]   (скриншоты — tools/qa/cat-*.png)
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5317;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const keep = process.argv.includes('--keep-server');
const coop = process.argv.includes('--coop');
// без слежения за файлами (tools/vite.qa.config.ts): правки других сессий не перезагружают страницу посреди проверки
const server = spawn(`npx vite --config tools/vite.qa.config.ts --port ${PORT} --strictPort`, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
const stopServer = () => {
  if (keep) return;
  try {
    // синхронно: иначе process.exit раньше taskkill — сервер остаётся висеть на порту со старыми модулями
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true });
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
const wait = (page, ms) => page.waitForTimeout(ms);
/** Взгляд в зал: к середине пола комнаты, вниз на pitch (вода — в кадре, а не марш лестницы перед носом). */
const lookHall = (page, pitch) =>
  page.evaluate((pitch) => {
    const c = window.__rf3d.fps, d = window.__rf3dFold, piece = d.portal.cache.peek(d.portal.current);
    let cx = 0, cy = 0, n = 0;
    for (const r of piece.floor) {
      const a = (r.x1 - r.x0) * (r.y1 - r.y0);
      cx += ((r.x0 + r.x1) / 2) * a;
      cy += ((r.y0 + r.y1) / 2) * a;
      n += a;
    }
    c.rotation.set(pitch, Math.atan2(cx / n - c.position.x, -cy / n - c.position.z), 0);
  }, pitch);
const st = (page) => page.evaluate(() => window.__rfCatacombs.state());

/** Где игрок: комната, её теги, биом кластера. */
const where = (page) =>
  page.evaluate(() => {
    const d = window.__rf3dFold, w = window.__rfWalk.world;
    const room = d.portal?.current ?? d.current.center;
    const inst = window.__rfWalk.rx.instances.find((i) => i.id === room);
    return { room, roomId: inst?.roomId, tags: inst?.roomTags, biome: w.clusterAt(room)?.biome?.id ?? null, n: window.__rfWalk.rx.instances.length };
  });

const setup = async (page, seed, biome, world = {}) => {
  await go(page, BASE);
  await page.evaluate(({ seed, biome }) => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed, deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, biome, on: true }));
  }, { seed, biome });
  await page.reload({ timeout: 180000 });
  await wait(page, 1000);
  await page.evaluate(async ({ world }) => {
    const { mutate } = await import('/src/model/store.ts');
    mutate((p) => Object.assign(p.world, world));
  }, { world });
  // холодный vite иногда перезагружает страницу (оптимизация зависимостей) — тогда ещё раз
  for (let k = 0; ; k++) {
    try {
      await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 60000 });
      await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rfCatacombs, null, { timeout: 180000 });
      break;
    } catch (e) {
      if (k >= 2) throw e;
      await page.screenshot({ path: out + `cat-setup-retry${k}.png` });
      await page.reload({ timeout: 180000 });
      await wait(page, 3000);
    }
  }
  await wait(page, 1500);
};

/**
 * Идти по сети (goTo по соседям, мир растёт вокруг игрока), пока не найдётся комната, для которой pick(inst) — истина;
 * сначала — непосещённые соседи. id комнаты или null.
 */
const findRoom = async (page, pickSrc, steps = 70) => {
  const seen = new Set();
  for (let k = 0; k < steps; k++) {
    const r = await page.evaluate(({ pickSrc, seen }) => {
      const pick = new Function('i', `return (${pickSrc})(i)`);
      const d = window.__rf3dFold, run = window.__rfWalk.rx;
      const cur = d.portal?.current ?? d.current.center;
      const by = new Map(run.instances.map((i) => [i.id, i]));
      const hit = run.instances.find((i) => i.roomTags[0] === 'катакомбы' && pick(i));
      if (hit) return { found: hit.id };
      const nb = [];
      for (const l of run.links) {
        if (l.kind === 'descent' || l.kind === 'lift' || l.sealed) continue;
        if (l.a.inst === cur) nb.push(l.b.inst);
        if (l.b.inst === cur) nb.push(l.a.inst);
      }
      const cand = nb.filter((x) => !seen.includes(x) && by.get(x)?.roomTags[0] === 'катакомбы');
      const all = nb.filter((x) => by.get(x)?.roomTags[0] === 'катакомбы');
      const next = cand[Math.floor(Math.random() * cand.length)] ?? all[Math.floor(Math.random() * all.length)] ?? null;
      return { next, cur };
    }, { pickSrc, seen: [...seen] });
    if (r.found) return r.found;
    if (!r.next) return null;
    seen.add(r.cur);
    seen.add(r.next);
    await page.evaluate((id) => window.__rf3dFold.goTo(id), r.next);
    await wait(page, 300);
  }
  return null;
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|AudioContext/i.test(m.text()) && errors.push(m.text().slice(0, 300)));

  // ═════════════════ A: вход ═════════════════
  await setup(page, 'qa-catacombs', 'catacombs', { trAfter: 100000 });
  const a0 = await where(page);
  ok('A старт в катакомбах: хаб', a0.biome === 'catacombs' && a0.tags?.[0] === 'катакомбы' && a0.tags.includes('хаб'), JSON.stringify(a0));
  await wait(page, 800);
  const hud = await page.evaluate(() => document.querySelector('.v3-walkhud')?.textContent ?? '');
  ok('A HUD — «Катакомбы»', hud.includes('Катакомбы'), hud);
  const fin = await page.evaluate(() => {
    return window.__rfWalk.rx.instances.map((i) => [i.roomTags[0], i.finish?.wall, i.finish?.floor]).filter((x) => x[0] === 'катакомбы');
  });
  ok('A отделка — f_cat_* (стены и пол)', fin.length > 0 && fin.every(([, wl, fl]) => /^f_cat_/.test(wl ?? '') && /^f_cat_/.test(fl ?? '')), JSON.stringify(fin.slice(0, 4)));
  // модели грузятся по очереди — дождаться и пересборки кусков с ними
  await page.waitForFunction(() => window.__rf3d.props.ready, null, { timeout: 300000 });
  await wait(page, 2500);
  const models = await page.evaluate(() => {
    const ids = ['p_cat_pipe_low', 'p_cat_pipe_mid', 'p_cat_pipe_high', 'p_cat_column_square', 'p_cat_bottle', 'p_cat_vault_1', 'p_cat_mattress', 'p_cat_post'];
    const sc = window.__rf3d.scene;
    return {
      missing: ids.filter((id) => !window.__rf3d.props.get(id)),
      clones: sc.meshes.filter((m) => m.name.startsWith('propModel:') && m.name.includes(':p_cat_')).length,
    };
  });
  ok('A модели катакомб загружены (не болванки), клоны в сцене', models.missing.length === 0 && models.clones > 0, JSON.stringify(models));
  const s0 = await st(page);
  const torch = await page.evaluate(() => window.__rfInv.flash());
  ok('A темно: hemi 0, свет у игрока погашен, туман катакомб', s0.on && (s0.hemi ?? 0) < 0.01 && s0.lamp !== true && s0.fog.mode === 3 && s0.fog.end <= 20, JSON.stringify({ hemi: s0.hemi, lamp: s0.lamp, fog: s0.fog }));
  ok('A фонарь в руке горит', torch.held && torch.on && torch.intensity > 0.5, JSON.stringify(torch));
  ok('A штиль: лужи 0.06 м, вода в комнатах есть', Math.abs(s0.level - 0.06) < 0.01 && s0.waterMeshes > 0 && s0.phase === 'calm', JSON.stringify({ level: s0.level, meshes: s0.waterMeshes, phase: s0.phase, untilRise: s0.untilRise }));
  await page.screenshot({ path: out + 'cat-1-dark.png' });

  // ═════════════════ B: наводнение ═════════════════
  // на пол хаба (спавн бывает на марше лестницы): свободное место рядом
  const fl = await page.evaluate(() => window.__rfCatacombs.toFloor());
  await wait(page, 900);
  const b0 = await st(page);
  ok('B на полу хаба (ноги у пола)', !!fl && b0.feet - b0.base < 0.3, JSON.stringify({ fl, feet: b0.feet, base: b0.base }));
  await page.evaluate(() => {
    const C = window.__rfCatacombs;
    C.force('warn');
  });
  await wait(page, 700);
  const flashWarn = await page.evaluate(() => document.querySelector('.v3-flash')?.textContent ?? '');
  ok('B предупреждение: подсказка «Вода идёт», чип воды', /Вода идёт/.test(flashWarn), flashWarn);
  await page.evaluate(() => {
    const C = window.__rfCatacombs;
    C.force('rise');
    C.speed(4);
  });
  await page.waitForFunction(() => window.__rfCatacombs.level() > 1.0, null, { timeout: 120000 });
  const b1 = await st(page);
  ok('B по пояс — «в воде» (лут: inWater)', await page.evaluate(() => window.__rfCatacombs.inWater()));
  ok('B вода поднимается; по пояс — ход медленнее', b1.phase === 'rise' && b1.level > 1.0 && b1.wade < 0.8 && b1.depth > 0.9, JSON.stringify({ level: b1.level, wade: b1.wade, depth: b1.depth, flow: b1.flow }));
  await page.evaluate(() => window.__rfCatacombs.speed(0));
  await lookHall(page, 0.45);
  await wait(page, 1200);
  await page.screenshot({ path: out + 'cat-2-rise.png' });
  await page.evaluate(() => window.__rfCatacombs.speed(4));
  await page.waitForFunction(() => window.__rfCatacombs.state().under, null, { timeout: 120000 });
  await page.evaluate(() => window.__rfCatacombs.speed(0));
  await wait(page, 1200);
  const b2 = await st(page);
  const under = await page.evaluate(() => !!document.querySelector('.v3-cat-under'));
  ok('B голова под водой: муть (туман и экран), воздух убывает', b2.under && under && b2.fog.end < 3, JSON.stringify({ level: b2.level, eye: b2.eye, fog: b2.fog, breath: b2.lungs.breath }));
  await page.screenshot({ path: out + 'cat-3-under.png' });
  await page.evaluate(() => window.__rfCatacombs.speed(6));
  await page.waitForFunction(() => window.__rfCatacombs.state().lungs.breath < 0.5, null, { timeout: 120000 });
  const air = await page.evaluate(() => !!document.querySelector('.v3-cat-air'));
  ok('B полоса воздуха в HUD', air);
  await page.waitForFunction(() => window.__rfCatacombs.state().dead, null, { timeout: 180000 });
  await page.waitForFunction(() => /Захлебнулся/.test(document.body.textContent ?? ''), null, { timeout: 20000 });
  const b3 = await st(page);
  ok('B захлебнулся: панель «Захлебнулся», «Ещё раз»', b3.dead && b3.lungs.cause === 'drown', JSON.stringify({ hp: b3.lungs.hp, level: b3.level }));
  await page.screenshot({ path: out + 'cat-4-dead.png' });
  await page.getByRole('button', { name: 'Ещё раз' }).click();
  await wait(page, 1500);
  const b4 = await st(page);
  ok('B «Ещё раз»: на сухой площадке (z ≥ 2.1), сухо, жив', !b4.dead && b4.feet - b4.base >= 2.05 && !b4.under && b4.depth === 0 && b4.lungs.hp === 100, JSON.stringify({ feet: b4.feet, base: b4.base, room: b4.room, level: b4.level, depth: b4.depth }));
  await page.screenshot({ path: out + 'cat-5-refuge.png' });
  // лечение (лут): +30 к 50 — 80, не выше 100
  const healed = await page.evaluate(() => {
    const C = window.__rfCatacombs;
    C.setLungs({ hp: 50 });
    C.heal(30);
    const a = C.lungs().hp;
    C.heal(500);
    return [a, C.lungs().hp];
  });
  ok('B heal(hp): +30 → 80, сверх полного — 100', healed[0] === 80 && healed[1] === 100, JSON.stringify(healed));
  // пик — пережить на площадке
  await page.evaluate(() => {
    const C = window.__rfCatacombs;
    C.force('peak');
    C.speed(3);
  });
  await wait(page, 4000);
  const b5 = await st(page);
  ok('B пик на площадке: голова над водой, воздух полный, жив', !b5.dead && !b5.under && b5.level > 1.9 && b5.lungs.breath > 0.99, JSON.stringify({ level: b5.level, feet: b5.feet, breath: b5.lungs.breath }));
  await page.screenshot({ path: out + 'cat-6-peak.png' });
  await page.evaluate(() => window.__rfCatacombs.force('ebb'));
  await wait(page, 600);
  // подсказки — по разу: «Вода прибывает!» (на полу при подъёме), «Вода уходит» (спад мог начаться, пока лежал мёртвым, —
  // тогда сразу после «Ещё раз»)
  const b55 = await st(page);
  ok('B подсказки по разу: подъём и спад показаны', b55.hinted.rise && b55.hinted.ebb && b55.phase === 'ebb', JSON.stringify(b55.hinted));
  await page.evaluate(() => {
    const C = window.__rfCatacombs;
    C.force('calm');
    C.speed(1);
  });
  await wait(page, 500);
  const b6 = await st(page);
  ok('B штиль снова: лужи', b6.phase === 'calm' && b6.level < 0.1, JSON.stringify({ phase: b6.phase, level: b6.level }));

  // ═════════════════ C: перелаз ═════════════════
  const pipeRoom = await findRoom(page, `(i) => i.decor.some((d) => d.propId === 'p_cat_pipe_low' || d.propId === 'p_cat_pipe_mid')`);
  ok('C нашёлся ход с трубой поперёк', !!pipeRoom, String(pipeRoom));
  if (pipeRoom) {
    await page.evaluate((id) => window.__rf3dFold.goTo(id), pipeRoom);
    await wait(page, 1500);
    const placed = await page.evaluate(() => window.__rfCatacombs.facePipe());
    // взгляд вниз — труба в кадре
    await page.evaluate(() => (window.__rf3d.fps.rotation.x = 0.5));
    await wait(page, 600);
    const c0 = await st(page);
    ok('C перед трубой: «E — перелезть»', !!placed && /E — перелезть/.test(c0.prompt ?? ''), JSON.stringify({ placed, prompt: c0.prompt, near: c0.nearPipe }));
    await page.screenshot({ path: out + 'cat-7-pipe.png' });
    const side = () =>
      page.evaluate((key) => {
        const g = window.__rfCatacombs.pipes().find((p) => p.key === key);
        const c = window.__rf3d.fps.position;
        return g ? Math.sign((c.x - g.cx) * g.nx + (-c.z - g.cy) * g.ny) : 0;
      }, placed?.key);
    const s1 = await side();
    await page.keyboard.press('KeyE');
    await wait(page, 300);
    const c1 = await st(page);
    await page.screenshot({ path: out + 'cat-8-climb.png' });
    await page.waitForFunction(() => !window.__rfCatacombs.state().climbing, null, { timeout: 20000 });
    await wait(page, 800);
    const s2 = await side();
    const c2 = await st(page);
    ok('C E — перелез: шла дуга, игрок по ту сторону трубы, стоя, на полу', c1.climbing && s1 !== 0 && s2 === -s1 && c2.pose === 'stand' && Math.abs(c2.feet - c2.base) < 0.25, JSON.stringify({ s1, s2, pose: c2.pose, feet: c2.feet, climbing: c1.climbing }));
    await page.screenshot({ path: out + 'cat-9-over.png' });
  }

  // ═════════════════ D: лаз ═════════════════
  const mouth = await findRoom(page, `(i) => i.roomTags.includes('устье')`);
  ok('D нашлось устье лаза', !!mouth, String(mouth));
  if (mouth) {
    await page.evaluate((id) => window.__rf3dFold.goTo(id), mouth);
    await wait(page, 1500);
    const ducts = await page.evaluate(() => window.__rfCatacombs.ducts());
    ok('D у устья — проём в лаз', ducts.length > 0, JSON.stringify(ducts));
    if (ducts.length) {
      // встать в 1 м перед проёмом лицом к нему
      await page.evaluate((q) => {
        const c = window.__rf3d.fps;
        window.__rf3d.posture.set('stand');
        window.__rf3d.posture.finish();
        c.position.set(q.x - q.ux * 1.0, q.y + 1.65, q.z - q.uz * 1.0);
        c.rotation.set(0.1, Math.atan2(q.ux, q.uz), 0);
        c.cameraDirection.setAll(0);
      }, { ...ducts[0], y: (await st(page)).base });
      await wait(page, 900);
      const d0 = await st(page);
      ok('D стоя у лаза: «C — ползком в лаз»', /C — ползком/.test(d0.prompt ?? ''), JSON.stringify({ prompt: d0.prompt, pose: d0.pose }));
      await page.evaluate(() => (window.__rf3d.fps.rotation.x = 0.45));
      await wait(page, 500);
      await page.screenshot({ path: out + 'cat-10-mouth.png' });
      /** Толкать камеру к лазу (по проёму): до входа в лаз и ещё extra м или max мс; комната в конце. */
      const push = (q, extra, max) =>
        page.evaluate(async ({ q, extra, max }) => {
          const c = window.__rf3d.fps;
          const t0 = performance.now();
          let at = null;
          while (performance.now() - t0 < max) {
            const s = window.__rfCatacombs.state();
            if (s.tags?.includes('лаз') && !at) at = c.position.clone();
            if (at && Math.hypot(c.position.x - at.x, c.position.z - at.z) >= extra) break;
            c.cameraDirection.set(q.ux * 0.05, 0, q.uz * 0.05);
            await new Promise((r) => requestAnimationFrame(r));
          }
          c.cameraDirection.setAll(0);
          return window.__rfCatacombs.state().tags;
        }, { q, extra, max });
      // стоя в лаз не пролезть: проём 0.8 м
      const standTags = await push(ducts[0], 0.3, 2500);
      const d00 = await st(page);
      ok('D стоя в лаз не пролезть (проём 0.8 м)', !standTags?.includes('лаз') && d00.pose === 'stand', JSON.stringify({ tags: standTags, pose: d00.pose }));
      await page.keyboard.press('KeyC');
      await wait(page, 900);
      // ползком — в лаз и ещё на 0.5 м
      await push(ducts[0], 0.5, 8000);
      await wait(page, 600);
      const d1 = await st(page);
      const room = await page.evaluate(() => window.__rf3d.posture.headroom());
      ok('D в лазе: на четвереньках, над головой низко', d1.tags?.includes('лаз') && d1.pose === 'crawl' && room < 1.25, JSON.stringify({ room: d1.room, tags: d1.tags, pose: d1.pose, headroom: room, eye: d1.eye - d1.base }));
      await page.screenshot({ path: out + 'cat-11-duct.png' });
    }
  }

  // ═════════════════ E: кооп ═════════════════
  if (coop) {
    const player = async (name, color) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const pg = await ctx.newPage();
      pg.on('pageerror', (e) => errors.push(`${name} PAGEERROR ${e.message}`));
      pg.on('console', (m) => m.type() === 'error' && !/pointer ?lock|AudioContext|WebSocket|ERR_CONNECTION_REFUSED/i.test(m.text()) && errors.push(`${name} ${m.text().slice(0, 300)}`));
      await go(pg, BASE);
      await pg.evaluate(({ name, color }) => {
        localStorage.clear();
        localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-cat-coop', deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, biome: 'catacombs', on: true }));
        localStorage.setItem('room-forge/coop/profile', JSON.stringify({ name, color, server: '', lastLobby: '' }));
      }, { name, color });
      await pg.reload({ timeout: 180000 });
      await pg.getByRole('button', { name: '3D', exact: true }).click({ timeout: 180000 });
      await pg.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rfCatacombs, null, { timeout: 180000 });
      return pg;
    };
    const online = (pg) => pg.waitForFunction(() => window.__rfCoop?.co?.status === 'online' && window.__rf3dFold?.portal?.isActive && window.__rfCatacombs, null, { timeout: 180000 });
    const A = await player('A', '#e0563f');
    const B = await player('B', '#4fb3e8');
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
    await B.waitForFunction(() => window.__rfCatacombs.state().on, null, { timeout: 60000 });
    const roles = [await A.evaluate(() => window.__rfCatacombs.state().authority), await B.evaluate(() => window.__rfCatacombs.state().authority)];
    ok('E кооп: часы ведёт хост (A), B — клиент', roles[0] === true && roles[1] === false, JSON.stringify(roles));
    const bForce = await B.evaluate(() => window.__rfCatacombs.force('rise'));
    ok('E force у клиента — null (часы не его)', bForce === null, JSON.stringify(bForce));
    await A.evaluate(() => {
      window.__rfCatacombs.force('rise');
      window.__rfCatacombs.speed(3);
    });
    await B.waitForFunction(() => window.__rfCatacombs.state().phase === 'rise' && window.__rfCatacombs.level() > 0.6, null, { timeout: 90000 });
    const lv = [await A.evaluate(() => window.__rfCatacombs.level()), await B.evaluate(() => window.__rfCatacombs.level())];
    ok('E у B — подъём, уровень как у хоста (срез fx flood)', Math.abs(lv[0] - lv[1]) < 0.35, JSON.stringify(lv));
    await B.screenshot({ path: out + 'cat-12-coop-B.png' });
    await A.evaluate(() => {
      window.__rfCatacombs.speed(1);
      window.__rfCatacombs.force('ebb');
    });
    await B.waitForFunction(() => window.__rfCatacombs.state().phase === 'ebb', null, { timeout: 20000 });
    ok('E спад у хоста — у B тоже', (await B.evaluate(() => window.__rfCatacombs.state().phase)) === 'ebb');
  }

  ok('ошибок на странице нет', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) {
  console.error(e);
  ok('скрипт дошёл до конца', false, String(e?.message ?? e));
} finally {
  await browser.close();
  stopServer();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} OK`);
  process.exit(bad.length ? 1 : 0);
}
