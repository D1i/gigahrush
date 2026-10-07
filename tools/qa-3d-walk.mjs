// QA «Прогулки» (бесконечный складчатый мир, портальный рендер) во вкладке «3D»:
//  1) авто-ходьба через 30+ порогов: камера с коллизиями и гравитацией идёт к проёму и сквозь него, текущая
//     комната меняется сама (по полу, autoCross), мир растёт (ensureAround/ensureVisible), скриншоты;
//  2) перезагрузка страницы — прогулка продолжается: та же комната, та же позиция, тот же мир;
//  3) возврат назад через несколько порогов — комнаты те же.
// node tools/qa-3d-walk.mjs [url] [seed] [порогов]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5211/';
const seed = process.argv[3] ?? 'qa-walk-1';
const want = Number(process.argv[4] ?? 32);
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: out + `walk-${seed}-${n}.png` });
const goto = async () => {
  for (let k = 0; k < 5; k++) {
    try {
      await page.goto(url, { timeout: 180000 });
      return;
    } catch (e) {
      console.log('goto:', String(e.message).slice(0, 100));
      await wait(3000);
    }
  }
};

await goto();
// чистый старт: прогулка этого сида, без сохранений
await page.evaluate((seed) => {
  for (const k of Object.keys(localStorage)) if (k.startsWith('room-forge/world/') || k === 'room-forge/walk') localStorage.removeItem(k);
  localStorage.setItem('room-forge/walk', JSON.stringify({ seed, deadEndChance: 0.15, branching: 1, aheadDoors: 2, on: true }));
}, seed);
await page.reload({ timeout: 180000 });
await wait(1200);
await page.getByRole('button', { name: '3D', exact: true }).click();
await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 120000 });
await wait(1500);
await shot('0-start');

// помощники в странице: ходьба к точке с коллизиями (cameraDirection), подход к проёму
await page.evaluate(() => {
  const v = window.__rf3d;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  window.__qaw = {
    frame,
    /** идти к точке плана (x, y) — до 300 кадров; true — дошли */
    async walkTo(x, y, speed = 0.06) {
      const cam = v.fps;
      cam.checkCollisions = true;
      cam.applyGravity = true;
      let last = null, still = 0;
      for (let k = 0; k < 300; k++) {
        const dx = x - cam.position.x, dy = -y - cam.position.z;
        const d = Math.hypot(dx, dy);
        if (d < 0.08) return true;
        const s = Math.min(speed, d);
        cam.cameraDirection.set((dx / d) * s, 0, (dy / d) * s);
        // смотреть по ходу
        cam.rotation.y = Math.atan2(dx, dy);
        cam.rotation.x = 0.05;
        await frame();
        const p = [cam.position.x, cam.position.z];
        if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.002) {
          if (++still > 40) return false;
        } else still = 0;
        last = p;
      }
      return false;
    },
  };
});

const visited = [];
const crossings = [];
let teleports = 0, stuck = 0;
for (let step = 0; crossings.length < want && step < want * 3; step++) {
  const st = await page.evaluate(async () => {
    const d = window.__rf3dFold, v = window.__rf3d, w = window.__rfWalk;
    const cur = d.portal.current;
    const piece = d.pieces.get(cur);
    return { cur, portals: piece.portals.map((q) => ({ to: q.to, axis: q.axis, at: q.at, dir: q.dir, lo: q.lo, hi: q.hi })), floor: piece.floor, rooms: w.rx.instances.length };
  });
  if (!visited.includes(st.cur)) visited.push(st.cur);
  // следующая дверь: в ещё не посещённую комнату (детерминированно), иначе — первая не назад
  const prev = crossings.length ? crossings[crossings.length - 1].from : null;
  const cand = st.portals.filter((q) => !visited.includes(q.to));
  const q = cand[0] ?? st.portals.find((x) => x.to !== prev) ?? st.portals[0];
  if (!q) {
    console.log('нет дверей у', st.cur);
    break;
  }
  const mid = (q.lo + q.hi) / 2;
  const P = (n) => (q.axis === 'x' ? [q.at + q.dir * n, mid] : [mid, q.at + q.dir * n]);
  const onFloor = (pt) => st.floor.some((r) => pt[0] > r.x0 + 0.32 && pt[0] < r.x1 - 0.32 && pt[1] > r.y0 + 0.32 && pt[1] < r.y1 - 0.32);
  let approach = null;
  for (const n of [-0.8, -0.6, -0.45, -0.35]) if (onFloor(P(n))) { approach = P(n); break; }
  if (!approach) approach = P(-0.35);
  const r = await page.evaluate(async ({ approach, through, after, to }) => {
    const { walkTo, frame } = window.__qaw;
    const d = window.__rf3dFold, v = window.__rf3d;
    const from = d.portal.current;
    let ok = await walkTo(approach[0], approach[1]);
    let tele = false;
    if (!ok) {
      // упёрлись (мебель, угол) — поставить у проёма и идти дальше уже сквозь него
      v.fps.position.set(approach[0], 1.65, -approach[1]);
      v.fps.cameraDirection.setAll(0);
      for (let k = 0; k < 5; k++) await frame();
      tele = true;
    }
    const passed = await walkTo(through[0], through[1]);
    await walkTo(after[0], after[1]);
    for (let k = 0; k < 4; k++) await frame();
    return { from, now: d.portal.current, to, tele, passed, pos: [v.fps.position.x, -v.fps.position.z], st: { ...d.portal.stats } };
  }, { approach, through: P(0.3), after: P(0.7), to: q.to });
  if (r.tele) teleports++;
  if (r.now === r.to) crossings.push({ from: r.from, to: r.to, dw: null, rooms: r.st.rooms, portals: r.st.portals });
  else {
    stuck++;
    console.log('не прошли', r.from, '→', r.to, 'сейчас', r.now, r.passed);
    if (stuck > 8) break;
    // не прошли — перейти напрямую (чтобы обход продолжался) и отметить
    await page.evaluate((to) => window.__rf3dFold.goTo(to), q.to);
    await wait(400);
  }
  if (crossings.length % 8 === 1 && r.now === r.to) {
    await wait(500);
    await shot(`1-walk-${crossings.length}`);
  }
}
await wait(1500); // автосохранение
const before = await page.evaluate(() => {
  const d = window.__rf3dFold, v = window.__rf3d, w = window.__rfWalk;
  const st = w.status();
  return {
    cur: d.portal.current,
    pos: [v.fps.position.x, v.fps.position.y, v.fps.position.z],
    rooms: w.rx.instances.length,
    world: w.rx.instances.map((i) => `${i.id}:${i.roomId}:${i.dx}:${i.dy}:${i.rot}:${i.w}`),
    links: w.rx.links.length,
    saved: st.saved,
    stats: st.stats,
    fps: v.engine.getFps(),
    portal: { ...d.portal.stats },
    mem: d.pieces.memory,
  };
});
console.log('порогов пройдено', crossings.length, 'телепортов к проёму', teleports, 'не прошли', stuck, 'комнат', before.rooms, 'сохранено', JSON.stringify(before.saved));
await page.getByLabel('Детектор 4D (отладка)').first().check().catch(() => {});
await wait(700);
await shot('2-detector');
await page.getByLabel('Детектор 4D (отладка)').first().uncheck().catch(() => {});

// ── перезагрузка: продолжение с того же места ──
await page.reload({ timeout: 180000 });
await wait(1200);
await page.getByRole('button', { name: '3D', exact: true }).click();
await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 120000 });
await wait(2500);
const after = await page.evaluate(() => {
  const d = window.__rf3dFold, v = window.__rf3d, w = window.__rfWalk;
  return { cur: d.portal.current, pos: [v.fps.position.x, v.fps.position.y, v.fps.position.z], rooms: w.rx.instances.length, world: w.rx.instances.map((i) => `${i.id}:${i.roomId}:${i.dx}:${i.dy}:${i.rot}:${i.w}`), stale: w.world.stale };
});
await shot('3-reloaded');
const same = before.world.every((s, i) => after.world[i] === s);
const posD = Math.hypot(after.pos[0] - before.pos[0], after.pos[2] - before.pos[2]);
console.log('после перезагрузки: комната', after.cur, '(было', before.cur + ')', 'сдвиг камеры', posD.toFixed(3), 'м', 'мир тот же', same, 'комнат', after.rooms, 'было', before.rooms, 'stale', after.stale);

// ── назад через несколько порогов: те же комнаты ──
const back = [];
for (const c of crossings.slice(-5).reverse()) {
  const r = await page.evaluate(async ({ from, to }) => {
    const d = window.__rf3dFold;
    if (d.portal.current !== to) return { skip: d.portal.current };
    const q = d.pieces.get(to).portals.find((x) => x.to === from);
    if (!q) return { noportal: true };
    const mid = (q.lo + q.hi) / 2;
    const P = (n) => (q.axis === 'x' ? [q.at + q.dir * n, mid] : [mid, q.at + q.dir * n]);
    const v = window.__rf3d;
    v.fps.position.set(P(-0.4)[0], 1.65, -P(-0.4)[1]);
    v.fps.cameraDirection.setAll(0);
    for (let k = 0; k < 5; k++) await window.__qaw?.frame?.();
    return { q: true };
  }, c);
  if (!r.q) {
    back.push({ ...c, r });
    break;
  }
  await page.evaluate(() => {
    const v = window.__rf3d;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    window.__qaw = window.__qaw ?? {
      frame,
      async walkTo(x, y, speed = 0.06) {
        const cam = v.fps;
        cam.checkCollisions = true;
        cam.applyGravity = true;
        for (let k = 0; k < 300; k++) {
          const dx = x - cam.position.x, dy = -y - cam.position.z;
          const d = Math.hypot(dx, dy);
          if (d < 0.08) return true;
          const s = Math.min(speed, d);
          cam.cameraDirection.set((dx / d) * s, 0, (dy / d) * s);
          cam.rotation.y = Math.atan2(dx, dy);
          await frame();
        }
        return false;
      },
    };
  });
  const r2 = await page.evaluate(async ({ from, to }) => {
    const d = window.__rf3dFold;
    const q = d.pieces.get(to).portals.find((x) => x.to === from);
    const mid = (q.lo + q.hi) / 2;
    const P = (n) => (q.axis === 'x' ? [q.at + q.dir * n, mid] : [mid, q.at + q.dir * n]);
    await window.__qaw.walkTo(P(0.3)[0], P(0.3)[1]);
    await window.__qaw.walkTo(P(0.7)[0], P(0.7)[1]);
    return { now: d.portal.current };
  }, c);
  back.push({ from: c.to, to: c.from, ok: r2.now === c.from });
}
console.log('назад', JSON.stringify(back));
const report = { seed, crossings, teleports, stuck, before: { ...before, world: before.world.length }, after: { ...after, world: after.world.length }, sameWorld: same, posD, back, errors };
writeFileSync(out + `qa-3d-walk-${seed}.json`, JSON.stringify(report, null, 2));
console.log('ошибки', errors);
await browser.close();
