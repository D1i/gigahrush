// QA предметов лута в руках «Прогулки» (src/view3d/inventory.ts, HotbarHud.tsx, BagHud.tsx) как игрок — настоящими
// нажатиями клавиш и мыши, со скриншотами: старт в сарае (тёмный биом), набор: П-2 (батарейки на исходе), батарейки,
// спички, хлеб, мешок; в рюкзаке — юзграм. Проверки: значки лута в хотбаре, бейдж стека, полоска заряда; F — спичка
// (свет у руки), П-2 — R меняет батарейки (полоска полная); ЛКМ — съесть хлеб; Tab — панель сумки (мышь отпущена, Tab —
// закрыть); ЛКМ по мешку — надет (скорость ×0.85 — с зажатой W путь короче); юзграм — камера на полу (снимок с зажатой
// W), через 10 с встал, взгляд тот же; точки лута в мире — E подбирает (операция loot).
// Свой vite (порт 5198, свой cacheDir — не мешает dev-серверам других сессий). Скриншоты — tools/qa/loot-*.png.
//   node tools/qa-loot-walk.mjs
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5198;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.qa.config.ts', import.meta.url)),
  root: ROOT,
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-qa-loot', import.meta.url)),
  server: { port: PORT, strictPort: true },
  logLevel: 'warn',
});
await server.listen();
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
const SEED = 'qa-loot-' + (process.argv[2] ?? '1');

/** Средняя яркость (0…255) прямоугольника в центре кадра. */
const lum = (page) =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const v = window.__rf3d;
        v.scene.onAfterRenderObservable.addOnce(() => {
          const gl = v.engine._gl;
          const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
          const rw = Math.floor(w * 0.5), rh = Math.floor(h * 0.5);
          const px = new Uint8Array(rw * rh * 4);
          gl.readPixels(Math.floor((w - rw) / 2), Math.floor((h - rh) / 2), rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let s = 0;
          for (let i = 0; i < px.length; i += 4) s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          res(s / (rw * rh));
        });
      }),
  );

/** Состояние рук и DOM хотбара. */
const st = (page) =>
  page.evaluate(() => {
    const q = window.__rfInv, v = window.__rf3d;
    const slots = [...document.querySelectorAll('.v3-hotbar .v3-slot')].map((el) => ({
      sel: el.classList.contains('sel'),
      icon: el.querySelector('img.inv-icon')?.getAttribute('src') ?? null,
      n: el.querySelector('.inv-n')?.textContent ?? null,
      bar: el.querySelector('.inv-bar > i')?.style.width ?? null,
      rar: !!el.querySelector('.inv-rar'),
      lit: el.classList.contains('lit'),
    }));
    const c = v.fps.position;
    const fx = q.fx();
    return {
      hotbar: q.hotbar(),
      hud: q.hud(),
      flash: q.flash(),
      light: q.light(),
      tr: q.tr(),
      fx: { down: fx.down, invuln: fx.invuln, speedMul: fx.speedMul, drunk: fx.drunk },
      slots,
      back: document.querySelector('.inv-back')?.textContent ?? null,
      held: document.querySelector('.v3-held')?.textContent ?? null,
      bagPanel: !!document.querySelector('.inv-bag'),
      veil: !!document.querySelector('.inv-veil'),
      flashMsg: document.querySelector('.v3-flash')?.textContent ?? null,
      pos: [c.x, c.y, c.z],
      rot: [v.fps.rotation.x, v.fps.rotation.y, v.fps.rotation.z],
      extraMul: v.sprint.extraMul,
      speed: v.fps.speed,
      locked: document.pointerLockElement === v.engine.getRenderingCanvas(),
      paused: !!window.__rfPaused,
    };
  });

/** Ждать, пока состояние st не станет pred (не дольше maxMs): в headless-рендере 4–10 к/с, а dt игры обрезан до 0.1 с —
 *  игровое время отстаёт от настоящего, поэтому таймеры (спичка 6 с, обморок 10 с) ждём по состоянию, а не по часам. */
async function until(page, pred, maxMs) {
  const t0 = Date.now();
  let s = await st(page);
  while (!pred(s) && Date.now() - t0 < maxMs) {
    await page.waitForTimeout(250);
    s = await st(page);
  }
  return s;
}

/** Пройти с зажатой W secs секунд: путь по кадрам (переносы — не путь), разворот на конце отрезка leg. */
const walkW = (page, secs, leg = 3) =>
  page.evaluate(
    async ({ secs, leg }) => {
      const c = window.__rf3d.fps;
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      const t0 = performance.now();
      let lx = c.position.x, lz = c.position.z, path = 0, legD = 0;
      while ((performance.now() - t0) / 1000 < secs) {
        await frame();
        const d = Math.hypot(c.position.x - lx, c.position.z - lz);
        lx = c.position.x;
        lz = c.position.z;
        if (d < 1.5) {
          path += d;
          legD += d;
        }
        if (legD >= leg) {
          c.rotation.y += Math.PI;
          legD = 0;
        }
      }
      return path / ((performance.now() - t0) / 1000);
    },
    { secs, leg },
  );

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // прогрев: vite при первом заходе в 3D догружает зависимости и перезагружает страницу
  await page.goto(BASE, { timeout: 180000 });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rf3d?.props?.ready, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(3000);
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|Outdated Optimize Dep/i.test(m.text()) && errors.push(m.text().slice(0, 300)));

  // ═════════ новый мир: сарай (тёмный биом) ═════════
  await page.goto(BASE, { timeout: 180000 });
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed, deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, biome: 'barn', on: true }));
    localStorage.setItem('room-forge/flashlight-sound', '0');
    localStorage.setItem('room-forge/breath-sound', '0');
  }, SEED);
  await page.reload({ timeout: 180000 });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rfWalk && window.__rfInv && window.__rf3dFold?.portal?.isActive && window.__rf3d?.props?.ready, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  const canvas = page.locator('.v3-stage canvas');
  await canvas.click({ position: { x: 300, y: 300 } });
  await page.waitForTimeout(400);

  // встать в начало самого длинного свободного хода (как qa-inventory-walk.mjs)
  const route = await page.evaluate(() => {
    const v = window.__rf3d, d = window.__rf3dFold, cam = v.fps, sc = v.scene;
    const ray = cam.getForwardRay(30);
    const solid = (m) => m.checkCollisions && m.isEnabled();
    const room = d.portal.current;
    const fl = d.pieces.get(room).model.floors.find((f) => f.inst === room);
    let best = null;
    for (const r of fl.rects)
      for (const fx of [0.25, 0.5, 0.75])
        for (const fy of [0.25, 0.5, 0.75]) {
          const px = r.x0 + (r.x1 - r.x0) * fx, py = r.y0 + (r.y1 - r.y0) * fy;
          const feet = cam.position.y - v.posture.eye;
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            const dx = Math.sin(a), dz = Math.cos(a);
            let free = 30;
            for (const off of [-0.28, 0, 0.28]) {
              ray.origin.set(px + dz * off, feet + 0.9, -py - dx * off);
              ray.direction.set(dx, 0, dz);
              ray.length = 30;
              const h = sc.pickWithRay(ray, solid);
              if (h?.hit) free = Math.min(free, h.distance);
            }
            if (!best || free > best.free) best = { free, x: px, z: -py, yaw: a };
          }
        }
    cam.position.set(best.x, cam.position.y, best.z);
    cam.rotation.set(0.12, best.yaw, 0);
    cam.cameraDirection.setAll(0);
    return { room, ...best };
  });
  console.log('ход', JSON.stringify(route));
  const start = (await st(page)).pos;
  const back = async () => {
    await page.evaluate(({ p, yaw }) => {
      const c = window.__rf3d.fps;
      c.position.set(p[0], p[1], p[2]);
      c.rotation.set(0.12, yaw, 0);
      c.cameraDirection.setAll(0);
    }, { p: start, yaw: route.yaw });
    await page.waitForTimeout(500);
  };

  // ═════════ набор для проверки ═════════
  await page.evaluate(() =>
    window.__rfInv.setHotbar({
      slots: [{ item: 'it_flashlight', on: true, q: 0.05 }, { item: 'it_batteries', n: 3 }, { item: 'it_matches', n: 5 }, { item: 'it_bread' }, { item: 'it_sack' }],
      sel: 0,
    }),
  );
  await page.waitForTimeout(1200);
  const s0 = await st(page);
  console.log('набор', JSON.stringify(s0.slots));
  ok('хотбар: значки лута (картинки) во всех 5 ячейках, уголок редкости', s0.slots.length === 5 && s0.slots.every((x) => x.icon && x.rar), JSON.stringify(s0.slots.map((x) => !!x.icon)));
  ok('бейдж стека ×3 / ×5, полоска заряда П-2 почти пуста', s0.slots[1].n === '×3' && s0.slots[2].n === '×5' && parseFloat(s0.slots[0].bar) <= 10, `${s0.slots[0].bar}`);
  ok('подпись предмета в руке: имя, редкость, клавиши', /Фонарик П-2/.test(s0.held ?? '') && /F — свет/.test(s0.held ?? ''), String(s0.held));
  const hb = await page.locator('.v3-hotbar').boundingBox();
  const clip = { x: hb.x - 200, y: hb.y - 70, width: hb.width + 400, height: hb.height + 76 };
  await page.screenshot({ path: out + 'loot-1-hotbar.png', clip });
  await page.screenshot({ path: out + 'loot-1-hand-p2-low.png' });

  // ═════════ R: батарейки ═════════
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(500);
  const r1 = await st(page);
  ok('R: П-2 — заряд полный, батареек 3 → 1', r1.hotbar.slots[0].q > 0.99 && r1.hotbar.slots[1]?.n === undefined && r1.hotbar.slots[1]?.item === 'it_batteries' && parseFloat(r1.slots[0].bar) >= 98, `${JSON.stringify(r1.hotbar.slots.slice(0, 2))} · ${r1.flashMsg}`);
  const lP2 = await lum(page);
  await page.screenshot({ path: out + 'loot-2-p2-reloaded.png' });

  // ═════════ F: спичка ═════════
  await page.keyboard.press('KeyF'); // П-2 выкл — темно
  await page.waitForTimeout(400);
  const lDark = await lum(page);
  await page.keyboard.press('Digit3');
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(700);
  const m1 = await st(page);
  const lMatch = await lum(page);
  await page.screenshot({ path: out + 'loot-3-match.png' });
  ok('F: спичка чиркнута — коробок ×4, свет у руки', m1.tr.match?.item === 'it_matches' && m1.hotbar.slots[2]?.n === 4 && m1.light?.kind === 'point', JSON.stringify({ match: m1.tr.match, light: m1.light }));
  ok('свет: П-2 ярче спички, спичка ярче темноты', lP2 > lMatch && lMatch > lDark + 0.5, `П-2 ${lP2.toFixed(1)} · спичка ${lMatch.toFixed(1)} · темно ${lDark.toFixed(1)}`);
  const m2 = await until(page, (s) => !s.tr.match, 40000);
  ok('спичка догорела за 6 с (игровых)', !m2.tr.match && !m2.light && m2.tr.t - m1.tr.t < 7.5, JSON.stringify({ dt: m2.tr.t - m1.tr.t, tr: m2.tr }));

  // ═════════ ЛКМ: хлеб ═════════
  await page.keyboard.press('Digit4');
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);
  const b1 = await st(page);
  ok('ЛКМ: хлеб съеден (ячейка пуста), вспышка', b1.locked && !b1.hotbar.slots[3] && /Хлеб/.test(b1.flashMsg ?? ''), `${b1.locked} ${b1.flashMsg}`);

  // ═════════ Tab: панель сумки ═════════
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  const t1 = await st(page);
  await page.screenshot({ path: out + 'loot-4-bag-panel.png' });
  ok('Tab: панель сумки открыта, мышь отпущена, без меню паузы', t1.bagPanel && !t1.locked && !(await page.locator('.v3-play-pause, .play-pause').count()), JSON.stringify({ panel: t1.bagPanel, locked: t1.locked }));
  await page.locator('.inv-bag .inv-cell').nth(2).hover();
  await page.waitForTimeout(200);
  await page.screenshot({ path: out + 'loot-4z-bag-tip.png' });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(600);
  const t2 = await st(page);
  ok('Tab: панель закрыта, мышь снова захвачена', !t2.bagPanel && t2.locked, JSON.stringify({ panel: t2.bagPanel, locked: t2.locked }));

  // ═════════ мешок: надеть, скорость ×0.85 ═════════
  await back();
  await page.keyboard.down('KeyW');
  const v0 = await walkW(page, 2.5);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Digit5');
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(500);
  const w1 = await st(page);
  ok('ЛКМ: мешок надет (сумка у хотбара), extraMul 0.85', w1.hotbar.back?.item === 'it_sack' && Math.abs(w1.extraMul - 0.85) < 1e-6 && /0\/3/.test(w1.back ?? ''), `${w1.extraMul} · ${w1.back}`);
  await back();
  await page.keyboard.down('KeyW');
  const v1p = walkW(page, 2.5);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out + 'loot-5-sack-walk.png' });
  const v1 = await v1p;
  await page.keyboard.up('KeyW');
  ok('с мешком идёшь медленнее (~×0.85)', v1 < v0 * 0.93 && v1 > v0 * 0.7, `${v0.toFixed(2)} → ${v1.toFixed(2)} м/с (×${(v1 / v0).toFixed(2)})`);

  // ═════════ юзграм: обморок 10 с ═════════
  await back();
  await page.evaluate(() => {
    const h = window.__rfInv.hotbar();
    window.__rfInv.setHotbar({ ...h, slots: h.slots.map((s, i) => (i === 3 ? { item: 'it_yuzgram' } : s)), sel: 3 });
  });
  await page.waitForTimeout(400);
  const y0 = await st(page);
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1600);
  const y1 = await st(page);
  await page.screenshot({ path: out + 'loot-6-faint-floor.png' });
  const seenY = await page.evaluate(
    () =>
      new Promise((res) => {
        const v = window.__rf3d;
        const o = v.scene.onAfterRenderTargetsRenderObservable.add(() => {
          v.scene.onAfterRenderTargetsRenderObservable.remove(o);
          res({ y: v.fps.position.y, z: v.fps.rotation.z });
        });
      }),
  );
  ok('юзграм: лежит — ход 0, неуязвим, пелена; в кадре глаз у пола, крен на бок', y1.fx.down && y1.fx.invuln && y1.extraMul === 0 && y1.veil && seenY.y < y1.pos[1] - 1 && Math.abs(seenY.z) > 1, JSON.stringify({ fx: y1.fx, seenY, pos: y1.pos }));
  ok('с зажатой W лежащий не ползёт', Math.hypot(y1.pos[0] - y0.pos[0], y1.pos[2] - y0.pos[2]) < 0.15, `${Math.hypot(y1.pos[0] - y0.pos[0], y1.pos[2] - y0.pos[2]).toFixed(3)} м`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: out + 'loot-6z-faint-dark.png' });
  await page.keyboard.up('KeyW');
  await until(page, (s) => !s.fx.down && !s.veil, 60000);
  await page.waitForTimeout(400);
  const y2 = await st(page);
  await page.screenshot({ path: out + 'loot-7-faint-up.png' });
  ok('через 10 с встал: взгляд тот же, пелены нет, ход снова есть', !y2.fx.down && !y2.veil && Math.abs(y2.rot[0] - y0.rot[0]) < 1e-3 && Math.abs(y2.rot[1] - y0.rot[1]) < 1e-3 && Math.abs(y2.rot[2]) < 1e-3 && y2.extraMul > 0.8, JSON.stringify({ before: y0.rot, after: y2.rot, mul: y2.extraMul }));

  // ═════════ пузырь ×2: пьяное падение 15 с (мутная пелена — пол виден), стоны ═════════
  await back();
  await page.evaluate(() => {
    const h = window.__rfInv.hotbar();
    window.__rfInv.setHotbar({ ...h, slots: h.slots.map((s, i) => (i === 3 ? { item: 'it_bubble', n: 2 } : s)), sel: 3 });
  });
  await page.waitForTimeout(400);
  const p0 = await st(page);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(500);
  const p1 = await st(page);
  ok('пузырь: пьян, меченый, ×2 скорость (× мешок)', p1.fx.drunk && !p1.fx.down && Math.abs(p1.extraMul - 2 * 0.85) < 1e-6, JSON.stringify({ fx: p1.fx, mul: p1.extraMul }));
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2200);
  const p2 = await st(page);
  await page.screenshot({ path: out + 'loot-9-drunk-floor.png' });
  await page.keyboard.up('KeyW');
  ok('второй пузырь: валяется (ход 0, пелена), с W не ползёт', p2.fx.down && p2.veil && p2.extraMul === 0 && Math.hypot(p2.pos[0] - p0.pos[0], p2.pos[2] - p0.pos[2]) < 0.15, JSON.stringify({ fx: p2.fx, d: Math.hypot(p2.pos[0] - p0.pos[0], p2.pos[2] - p0.pos[2]) }));
  // встать (15 с), дальше — лут
  await page.waitForFunction(() => !window.__rfInv.fx().down, null, { timeout: 90000 });
  const p3 = await st(page);
  ok('после падения встал: взгляд тот же', Math.abs(p3.rot[0] - p0.rot[0]) < 1e-3 && Math.abs(p3.rot[1] - p0.rot[1]) < 1e-3 && Math.abs(p3.rot[2]) < 1e-3, JSON.stringify({ before: p0.rot, after: p3.rot }));

  // ═════════ точка лута в мире: E — операция loot ═════════
  const spot = await page.evaluate(() => {
    const inv = window.__rfInv.inv;
    const loot = inv.seen?.loot ?? [];
    return { n: loot.length, all: loot.map((d) => ({ id: d.id, inst: d.inst, item: d.item, n: d.n, x: d.x, y: d.y, z: d.z })), rooms: [...new Set(loot.map((d) => d.inst))].length };
  });
  console.log('лут', JSON.stringify({ n: spot.n, rooms: spot.rooms, first: spot.all.slice(0, 4) }));
  ok('точки лута показанных комнат — в мире (WorldItems)', spot.n > 0, `${spot.n} точек в ${spot.rooms} комнатах`);
  let picked = false;
  for (const d of spot.all.slice(0, 8)) {
    // в комнату точки (портальный рендер), встать в 0.8 м от неё — по очереди с 4 сторон — и смотреть на неё
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      await page.evaluate(({ d, a }) => {
        const v = window.__rf3d, c = v.fps, dr = window.__rf3dFold;
        if (dr.portal.current !== d.inst) dr.goTo(d.inst);
        c.position.set(d.x + Math.sin(a) * 0.8, d.y + 1.62, d.z + Math.cos(a) * 0.8);
        const yaw = Math.atan2(d.x - c.position.x, d.z - c.position.z);
        c.rotation.set(Math.atan2(c.position.y - d.y, 0.8) - 0.1, yaw, 0);
        c.cameraDirection.setAll(0);
      }, { d, a });
      await page.waitForTimeout(900);
      const aim = await page.evaluate(() => ({ id: window.__rfInv.aimed()?.id ?? null, room: window.__rf3dFold.portal.current, prompt: [...document.querySelectorAll('.v3-stage > .v3-lift-prompt')].map((e) => e.textContent).join(' | ') }));
      if (aim.id !== d.id) continue;
      await page.screenshot({ path: out + 'loot-8-aim-spot.png' });
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(900);
      const r = await page.evaluate((d) => ({ taken: window.__rfWalk.world.lootTaken(d.id), has: JSON.stringify(window.__rfInv.hotbar()).includes(d.item), shown: window.__rfInv.items.has(d.id), msg: document.querySelector('.v3-flash')?.textContent ?? null }), d);
      ok(`E: точка лута ${d.id} (${d.item}${d.n ? ' ×' + d.n : ''}) подобрана — флаг мира, в руках, на полу нет`, r.taken && r.has && !r.shown, JSON.stringify({ ...r, prompt: aim.prompt }));
      picked = true;
      break;
    }
    if (picked) break;
  }
  if (!picked) ok('точка лута под взглядом (E)', false, 'ни одна из 8 точек не попала под взгляд');
  ok('без ошибок страницы', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) {
  console.error(e);
  ok('скрипт отработал', false, String(e?.message ?? e));
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
