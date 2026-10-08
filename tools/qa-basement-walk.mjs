// QA подвала в «Прогулке» (docs/GENERATOR-4D.md §17): playwright + системный Chrome, свой vite (порт 5220).
//  A: старт в подвале — хаб: модели набора пользователя (стеллажи, столбы, лампы) вместо боксов, отделка подвала,
//     HUD «Подвал»; вид вдоль хода — длинный; марш наверх — закрытый выход; рамки подмешей моделей в кусках
//     портального рендера — там, где модель (иначе drawRoom отсекает её, и модель мигает, когда подходишь).
//  B: кольцо из хаба: пройти его комнатами (через проёмы) — снова в хабе, через другой проход.
//  C: бесконечный прямой участок: шагнул в шов — камера перенесена на длину участка назад, текущая — тройник; кадр до и
//     после шага одинаковый (картинка не прыгает).
//  D: марш хаба наверх: «E — открыть дверь» → квартиры (не подвал), выходы подвала исчезли.
// Скриншоты — tools/qa/bsm-*.png. node tools/qa-basement-walk.mjs [--keep-server]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5220;
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

/** Новый мир со стартом в подвале и настройками ходов t. */
const setup = async (page, seed, t) => {
  await page.goto(BASE, { timeout: 180000 });
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed, deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, on: true }));
  }, seed);
  await page.reload({ timeout: 180000 });
  await page.waitForTimeout(800);
  await page.evaluate(async (t) => {
    const { mutate } = await import('/src/model/store.ts');
    mutate((p) => {
      p.world.startBiome = 'basement';
      p.world.trAfter = 100000;
      Object.assign(p.world.tunnels, t);
    });
  }, t);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rf3d?.props?.ready, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
};

/** Пройти камерой через проём из текущей комнаты в to: встать перед проёмом, шагнуть за плоскость. */
const crossTo = (page, to) =>
  page.evaluate(async (to) => {
    const d = window.__rf3dFold, v = window.__rf3d, cam = v.fps;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const cur = d.portal.current;
    const piece = d.pieces.get(cur);
    const q = piece?.portals.find((p) => p.to === to);
    if (!q) return { ok: false, why: `нет проёма ${cur}→${to}` };
    cam.position.set(q.center.x - q.u.x * 0.5, cam.position.y, q.center.z - q.u.z * 0.5);
    cam.rotation.y = Math.atan2(q.u.x, q.u.z);
    for (let k = 0; k < 6; k++) await frame();
    for (let k = 0; k < 120 && d.portal.current === cur; k++) {
      cam.cameraDirection.set(q.u.x * 0.04, 0, q.u.z * 0.04);
      await frame();
    }
    for (let k = 0; k < 4; k++) await frame();
    return { ok: d.portal.current === to, cur: d.portal.current, wrap: !!q.shiftB };
  }, to);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // прогрев: vite при первом заходе в 3D догружает зависимости (загрузчик glTF) и перезагружает страницу
  await page.goto(BASE, { timeout: 180000 });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rf3d?.props?.ready, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(3000);
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock/i.test(m.text()) && errors.push(m.text().slice(0, 300)));

  // ═════════ A: хаб и ход ═════════
  await setup(page, 'qa-bsm-a', { ring: 0, loop: 0 });
  const a0 = await page.evaluate(() => {
    const w = window.__rfWalk.world, d = window.__rf3dFold, v = window.__rf3d;
    const room = d.portal.current;
    const cl = w.clusterAt(room);
    const models = v.scene.meshes.filter((m) => m.name.startsWith('propModel:') && m.isEnabled() && m.isVisible).length;
    const inst = window.__rfWalk.rx.instances.find((i) => i.id === room);
    return { room, roomName: inst?.roomName, tags: inst?.roomTags, cl: cl && { biome: cl.biome?.id, tunnels: cl.tunnels, exits: cl.exits }, models, props: v.props.size, finish: inst?.finish, hud: document.body.innerText.includes('Подвал') };
  });
  ok('A старт — хаб подвала (сеть ходов), выход-марш закрыт', a0.tags?.includes('хаб') && a0.cl?.tunnels && a0.cl?.biome === 'basement' && a0.cl.exits >= 1, JSON.stringify(a0));
  ok('A модели набора загружены и стоят в хабе', a0.props >= 20 && a0.models >= 4, `шаблонов ${a0.props}, моделей в сцене ${a0.models}`);
  ok('A отделка подвала: кирпич с побелкой / бетон', ['f_bsm_brick', 'f_concrete'].includes(a0.finish?.wall) && a0.finish?.floor === 'f_bsm_concrete', JSON.stringify(a0.finish));
  ok('A HUD — «Подвал»', a0.hud);
  // из середины хаба на четыре стороны: сквозь проходы ход виден на несколько проёмов вглубь
  const c0 = await page.evaluate(() => {
    const d = window.__rf3dFold;
    const room = d.portal.current;
    const fl = d.pieces.get(room).model.floors.find((f) => f.inst === room);
    const r = fl.rects.reduce((a, b) => ((b.x1 - b.x0) * (b.y1 - b.y0) > (a.x1 - a.x0) * (a.y1 - a.y0) ? b : a));
    return { cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2 };
  });
  let deep = 0;
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    await page.evaluate(({ c, yaw }) => {
      const cam = window.__rf3d.fps;
      cam.position.set(c.cx, cam.position.y, -c.cy);
      cam.rotation.set(0.05, yaw, 0);
      cam.cameraDirection.setAll(0);
    }, { c: c0, yaw });
    await page.waitForTimeout(1200);
    const lv = await page.evaluate(() => window.__rf3dFold.portalStats?.levels ?? 0);
    if (lv > deep) {
      deep = lv;
      await page.screenshot({ path: out + 'bsm-1-hub.png' });
    }
  }
  ok('A из хаба вдоль хода видно далеко (≥ 3 проёмов вглубь)', deep >= 3, `глубина ${deep}`);
  // в ход: первый проход хаба
  const tunnel = await page.evaluate(() => {
    const d = window.__rf3dFold, rx = window.__rfWalk.rx;
    const room = d.portal.current;
    const piece = d.pieces.get(room);
    const q = piece.portals.find((p) => rx.instances.find((i) => i.id === p.to)?.roomTags.includes('ход'));
    return q ? q.to : null;
  });
  ok('A у хаба есть ход', !!tunnel);
  if (tunnel) {
    const r = await crossTo(page, tunnel);
    ok('A шагнул в ход', r.ok, JSON.stringify(r));
    await page.waitForTimeout(2500);
    // смотреть вдоль хода: на дальний проход этого куска
    const far = await page.evaluate((hub) => {
      const d = window.__rf3dFold, cam = window.__rf3d.fps;
      const piece = d.pieces.get(d.portal.current);
      const q = piece.portals.find((p) => p.to !== hub);
      if (!q) return null;
      cam.rotation.set(0.05, Math.atan2(q.center.x - cam.position.x, q.center.z - cam.position.z), 0);
      return q.to;
    }, a0.room);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: out + 'bsm-2-tunnel.png' });
    void far;
  }
  // рамки подмешей моделей (слиты по материалам — подмешей несколько): в мире, там, где вершины
  const boxes = await page.evaluate(() => {
    const d = window.__rf3dFold;
    let clones = 0, subs = 0, bad = 0, worst = 0;
    for (const piece of d.pieces.pieces.values()) {
      for (const m of piece.meshes) {
        if (!m.name.startsWith('propModel:')) continue;
        clones++;
        const wm = m.getWorldMatrix(), pos = m.getVerticesData('position'), idx = m.getIndices();
        const V = m.position.constructor;
        for (const sm of m.subMeshes) {
          subs++;
          const bb = sm.getBoundingInfo().boundingBox;
          let miss = 0;
          for (let i = sm.indexStart; i < sm.indexStart + sm.indexCount; i++) {
            const v = idx[i];
            const p = V.TransformCoordinates(new V(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]), wm);
            miss = Math.max(miss, bb.minimumWorld.x - p.x, p.x - bb.maximumWorld.x, bb.minimumWorld.y - p.y, p.y - bb.maximumWorld.y, bb.minimumWorld.z - p.z, p.z - bb.maximumWorld.z);
          }
          if (miss > 1e-3) bad++;
          worst = Math.max(worst, miss);
        }
      }
    }
    return { clones, subs, bad, worst: +worst.toFixed(2) };
  });
  ok('A рамки подмешей моделей — на месте моделей (не мигают при подходе)', boxes.clones >= 10 && boxes.subs > boxes.clones && boxes.bad === 0, JSON.stringify(boxes));

  // ═════════ B: кольцо ═════════
  await setup(page, 'qa-bsm-ring', { ring: 1, loop: 0 });
  const ring = await page.evaluate(() => {
    const w = window.__rfWalk.world, d = window.__rf3dFold;
    const hub = d.portal.current;
    w.expand(hub);
    const run = w.run();
    if (!w.stats().rings) return { hub, rings: 0 };
    // кольцо: путь от одного соседа хаба до другого, не через хаб
    const nb = (id) => run.links.filter((l) => !l.kind && !l.wrap && (l.a.inst === id || l.b.inst === id)).map((l) => (l.a.inst === id ? l.b.inst : l.a.inst));
    const first = nb(hub);
    for (const s of first) {
      const prev = new Map([[s, null]]);
      const q = [s];
      while (q.length) {
        const x = q.shift();
        for (const y of nb(x)) {
          if (y === hub || prev.has(y)) continue;
          prev.set(y, x);
          q.push(y);
        }
      }
      for (const t of first) {
        if (t === s || !prev.has(t)) continue;
        const path = [];
        for (let x = t; x; x = prev.get(x)) path.unshift(x);
        return { hub, rings: w.stats().rings, path };
      }
    }
    return { hub, rings: w.stats().rings, path: null };
  });
  ok('B из хаба вышло кольцо', ring.rings >= 1 && ring.path && ring.path.length >= 4, JSON.stringify({ rings: ring.rings, len: ring.path?.length }));
  if (ring.path) {
    await page.waitForTimeout(2000);
    let okAll = true;
    let last = null;
    for (const id of [...ring.path, ring.hub]) {
      await page.waitForFunction((id) => window.__rfWalk.rx.instances.some((i) => i.id === id), id, { timeout: 20000 }).catch(() => {});
      const r = await crossTo(page, id);
      if (!r.ok) { okAll = false; last = r; break; }
    }
    const cur = await page.evaluate(() => window.__rf3dFold.portal.current);
    ok('B прошёл кольцо комнатами — снова в хабе', okAll && cur === ring.hub, JSON.stringify({ cur, hub: ring.hub, last }));
    await page.screenshot({ path: out + 'bsm-3-ring-back.png' });
  }

  // ═════════ C: бесконечный прямой участок ═════════
  await setup(page, 'qa-bsm-loop', { ring: 0, loop: 1, hubEvery: [400, 500] });
  const loop = await page.evaluate(() => {
    const s = window.__rfWalk, w = s.world;
    // раскрыть мир, пока не появится шов
    const seen = new Set();
    const q = [w.startId];
    while (q.length && !w.run().links.some((l) => l.wrap) && seen.size < 200) {
      const id = q.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      w.expand(id);
      for (const l of w.run().links) {
        if (l.kind) continue;
        if (l.a.inst === id) q.push(l.b.inst);
        if (l.b.inst === id) q.push(l.a.inst);
      }
    }
    const l = w.run().links.find((x) => x.wrap);
    return l ? { a: l.a.inst, b: l.b.inst, wrap: l.wrap } : null;
  });
  ok('C в подвале есть бесконечный участок (шов)', !!loop, JSON.stringify(loop));
  if (loop) {
    await page.waitForFunction((id) => window.__rfWalk.rx.instances.some((i) => i.id === id), loop.a, { timeout: 20000 }).catch(() => {});
    await page.evaluate((id) => window.__rf3dFold.goTo(id), loop.a);
    await page.waitForTimeout(2500);
    // встать перед швом, лицом к нему; кадр до шага
    const pre = await page.evaluate((to) => {
      const d = window.__rf3dFold, cam = window.__rf3d.fps;
      const q = d.pieces.get(d.portal.current).portals.find((p) => p.to === to && p.shiftB);
      if (!q) return null;
      cam.position.set(q.center.x - q.u.x * 0.25, cam.position.y, q.center.z - q.u.z * 0.25);
      cam.rotation.set(0.05, Math.atan2(q.u.x, q.u.z), 0);
      cam.cameraDirection.setAll(0);
      return { x: cam.position.x, z: cam.position.z, ux: q.u.x, uz: q.u.z, shift: [q.shiftB.x, q.shiftB.z] };
    }, loop.b);
    ok('C у шва — проём со сдвигом сцены', !!pre, JSON.stringify(pre));
    if (pre) {
      await page.waitForTimeout(1500);
      const before = await page.screenshot({ path: out + 'bsm-4-seam-before.png' });
      // шаг на 0.5 м вперёд — за шов
      const step = await page.evaluate(async (pre) => {
        const d = window.__rf3dFold, cam = window.__rf3d.fps;
        const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
        const from = d.portal.current;
        for (let k = 0; k < 40 && d.portal.current === from; k++) {
          cam.cameraDirection.set(pre.ux * 0.03, 0, pre.uz * 0.03);
          await frame();
        }
        for (let k = 0; k < 10; k++) await frame();
        return { from, cur: d.portal.current, x: cam.position.x, z: cam.position.z };
      }, pre);
      const jump = Math.hypot(step.x - pre.x, step.z - pre.z);
      const want = Math.hypot(pre.shift[0], pre.shift[1]);
      ok('C шагнул в шов — текущая комната тройник, камера перенесена на длину участка', step.cur === loop.b && Math.abs(jump - want) < 1.2, JSON.stringify({ ...step, jump: +jump.toFixed(2), want: +want.toFixed(2) }));
      // вернуться на 0.15 м назад по ходу (на ту же точку относительно тройника, что и до шага) и сравнить кадры
      await page.evaluate((pre) => {
        const cam = window.__rf3d.fps;
        cam.position.set(pre.x - pre.shift[0], cam.position.y, pre.z - pre.shift[1]);
        cam.cameraDirection.setAll(0);
      }, pre);
      await page.waitForTimeout(1500);
      const after = await page.screenshot({ path: out + 'bsm-5-seam-after.png' });
      const diff = await page.evaluate(async ([a, b]) => {
        const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        const c = document.createElement('canvas');
        c.width = 1280; c.height = 800;
        const g = c.getContext('2d');
        g.drawImage(ia, 0, 0);
        const da = g.getImageData(250, 60, 690, 680).data;
        g.drawImage(ib, 0, 0);
        const db = g.getImageData(250, 60, 690, 680).data;
        let s = 0;
        for (let i = 0; i < da.length; i += 4) s += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
        return s / (da.length / 4) / 3;
      }, [`data:image/png;base64,${before.toString('base64')}`, `data:image/png;base64,${after.toString('base64')}`]);
      ok('C за швом — та же картинка (средняя разница пикселя < 6 из 255)', diff < 6, `разница ${diff.toFixed(2)}`);
    }
  }

  // ═════════ D: марш наверх ═════════
  await setup(page, 'qa-bsm-up', { ring: 0, loop: 0 });
  const up = await page.evaluate(() => {
    const s = window.__rfWalk, d = window.__rf3dFold, w = s.world;
    const room = d.portal.current;
    const inst = s.rx.instances.find((i) => i.id === room);
    const k = inst.connectors.find((c) => c.exit);
    if (!k) return null;
    const de = d.deadEndAt(room, k.id);
    const cam = window.__rf3d.fps;
    cam.position.set(de.center.x + de.u.x * 0.8, de.center.y + 1.65, de.center.z + de.u.z * 0.8);
    cam.rotation.set(0.05, Math.atan2(-de.u.x, -de.u.z), 0);
    cam.cameraDirection.setAll(0);
    return { room, conn: k.id };
  });
  ok('D у хаба — дверь-марш наверх (закрытый выход)', !!up);
  if (up) {
    await page.waitForTimeout(600);
    const pr = await page.evaluate(() => [...document.querySelectorAll('.v3-lift-prompt')].map((e) => e.textContent).join(' | '));
    ok('D подсказка «E — открыть дверь»', pr.includes('E — открыть дверь'), pr || '—');
    await page.keyboard.press('KeyE');
    await page.waitForFunction((r) => window.__rfWalk.world.doorState(r.room, r.conn) === 'linked', up, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const d = await page.evaluate((r) => {
      const w = window.__rfWalk.world;
      const l = w.run().links.find((x) => (x.a.inst === r.room && x.a.connector === r.conn) || (x.b.inst === r.room && x.b.connector === r.conn));
      const other = l && (l.a.inst === r.room ? l.b.inst : l.a.inst);
      const cl = other && w.clusterAt(other);
      return { other, biome: cl?.biome?.id, tunnels: cl?.tunnels, exitsBasement: w.clusterAt(r.room).exits };
    }, up);
    ok('D за маршем — квартиры, выходы подвала исчезли', d.other && d.tunnels === false && d.exitsBasement === 0, JSON.stringify(d));
    await page.screenshot({ path: out + 'bsm-6-up.png' });
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
