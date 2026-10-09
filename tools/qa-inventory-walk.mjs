// QA рук «Прогулки» (src/view3d/inventory.ts) как игрок — настоящими нажатиями клавиш, со скриншотами: старт в сарае
// (тёмный биом, Biome.dark), хотбар с фонариком в ячейке 1; F — свет вкл/выкл (яркость кадра); Shift+W — бег (шкала
// выносливости, путь больше, чем пешком за то же время), до изнеможения (шкала красная, скорость — шаг); G — фонарь на полу
// (светит, ячейка пуста), взгляд на него — «E — подобрать: Фонарик», E — снова в руке; G — перезагрузка — лежит там же,
// хотбар тот же; ячейка 2 (пусто) — в руке ничего. Плюс раскладка HUD: хотбар, шкала, имя предмета, подсказка, подсказки
// управления — не налезают друг на друга.
// Свой vite (порт 5263, свой cacheDir — не мешает dev-серверам других сессий). Скриншоты — tools/qa/inv-*.png.
//   node tools/qa-inventory-walk.mjs
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5263;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.qa.config.ts', import.meta.url)),
  root: ROOT,
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-qa-inventory', import.meta.url)),
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
const SEED = 'qa-inv-' + (process.argv[2] ?? '1');

/** Средняя яркость (0…255) прямоугольника в центре кадра — из буфера сразу после рендера. */
const lum = (page) =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const v = window.__rf3d;
        v.scene.onAfterRenderObservable.addOnce(() => {
          const gl = v.engine._gl;
          const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
          const rw = Math.floor(w * 0.4), rh = Math.floor(h * 0.4);
          const px = new Uint8Array(rw * rh * 4);
          gl.readPixels(Math.floor((w - rw) / 2), Math.floor((h - rh) / 2), rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let s = 0;
          for (let i = 0; i < px.length; i += 4) s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          res(s / (rw * rh));
        });
      }),
  );

/** Состояние рук, бега и DOM хотбара. */
const st = (page) =>
  page.evaluate(() => {
    const q = window.__rfInv, v = window.__rf3d, w = window.__rfWalk;
    const slots = [...document.querySelectorAll('.v3-hotbar .v3-slot')].map((el) => ({ sel: el.classList.contains('sel'), glyph: !!el.querySelector('svg, .v3-glyph-box'), lit: el.classList.contains('lit') }));
    const bar = document.querySelector('.v3-stamina');
    const fill = bar?.firstElementChild;
    const prompt = [...document.querySelectorAll('.v3-stage > .v3-lift-prompt')].map((e) => e.textContent);
    const c = v.fps.position;
    return {
      hotbar: q.hotbar(),
      flash: q.flash(),
      aimed: q.aimed()?.id ?? null,
      drops: w.drops().map((d) => ({ id: d.id, item: d.item, inst: d.inst, x: +d.x.toFixed(3), y: +d.y.toFixed(3), z: +d.z.toFixed(3), yaw: d.yaw, on: d.on })),
      slots,
      prompt,
      held: document.querySelector('.v3-held')?.textContent ?? null,
      bar: bar ? { on: bar.classList.contains('on'), tired: bar.classList.contains('tired'), w: fill?.style.transform ?? '' } : null,
      sprint: { ...v.sprint.state },
      pos: [c.x, c.y, c.z],
      feet: c.y - v.posture.eye,
      room: window.__rf3dFold.portal?.current ?? null,
      hemi: v.scene.getLightByName('hemi')?.intensity ?? null,
      locked: document.pointerLockElement === v.engine.getRenderingCanvas(),
    };
  });

/** Прямоугольники HUD внизу (видимые) и их пересечения. */
const layout = (page) =>
  page.evaluate(() => {
    const sel = ['.v3-hotbar', '.v3-stamina.on', '.v3-held', '.v3-stage > .v3-lift-prompt', '.v3-stage > .v3-obsh-hint', '.v3-hud', '.v3-perf', '.coop-hud'];
    const boxes = [];
    for (const s of sel)
      for (const el of document.querySelectorAll(s)) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || +cs.opacity < 0.05) continue;
        const r = el.getBoundingClientRect();
        if (r.width && r.height) boxes.push({ s, x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
      }
    const hits = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5) hits.push(`${a.s} × ${b.s}`);
      }
    return { boxes: boxes.map((b) => `${b.s} [${b.x0 | 0},${b.y0 | 0}–${b.x1 | 0},${b.y1 | 0}]`), hits };
  });

const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // прогрев: vite при первом заходе в 3D догружает зависимости и перезагружает страницу
  await page.goto(BASE, { timeout: 180000 });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rf3d?.props?.ready, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(3000);
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock/i.test(m.text()) && errors.push(m.text().slice(0, 300)));

  // ═════════ новый мир: старт в сарае (тёмный биом) ═════════
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
  // захват мыши — клик по холсту, как игрок (фокус клавиатуры — на холсте)
  const canvas = page.locator('.v3-stage canvas');
  await canvas.click({ position: { x: 300, y: 300 } });
  await page.waitForTimeout(400);

  // встать в начало самого длинного свободного хода (лучи на высоте пояса; три параллельных — ширина тела)
  const route = await page.evaluate(async () => {
    const v = window.__rf3d, d = window.__rf3dFold, cam = v.fps, sc = v.scene;
    // луч нужного класса — от камеры (модули Babylon страницы из page.evaluate не импортировать: другой экземпляр)
    const ray = cam.getForwardRay(30);
    const solid = (m) => m.checkCollisions && m.isEnabled();
    const room = d.portal.current;
    const fl = d.pieces.get(room).model.floors.find((f) => f.inst === room);
    let best = null;
    for (const r of fl.rects) {
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
    }
    cam.position.set(best.x, cam.position.y, best.z);
    cam.rotation.set(0.12, best.yaw, 0);
    cam.cameraDirection.setAll(0);
    return { room, ...best };
  });
  console.log('ход', JSON.stringify(route));
  await page.waitForTimeout(1500);
  const s0 = await st(page);
  console.log('старт', JSON.stringify({ hotbar: s0.hotbar, flash: s0.flash, slots: s0.slots, hemi: s0.hemi, room: s0.room, locked: s0.locked }));
  ok('хотбар: 5 ячеек, фонарик в ячейке 1 (выбрана), включён', s0.slots.length === 5 && s0.slots[0].glyph && s0.slots[0].sel && s0.slots[0].lit && s0.slots.slice(1).every((x) => !x.glyph) && s0.hotbar.slots[0]?.item === 'it_flashlight' && s0.hotbar.slots[0]?.on === true);
  ok('в руке фонарь: модель и свет', s0.flash.held && s0.flash.on && s0.flash.intensity > 0.3, JSON.stringify(s0.flash));
  ok('тёмный биом (сарай): свет сцены приглушён', s0.hemi != null && s0.hemi < 0.4, `hemi ${s0.hemi}`);
  await page.screenshot({ path: out + 'inv-1-hand-on.png' });
  const hb = await page.locator('.v3-hotbar').boundingBox();
  const clip = { x: hb.x - 60, y: hb.y - 120, width: hb.width + 120, height: hb.height + 126 };
  await page.screenshot({ path: out + 'inv-1z-hotbar.png', clip });

  // ═════════ F: свет вкл / выкл ═════════
  const lOn = await lum(page);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(500);
  const lOff = await lum(page);
  const sOff = await st(page);
  await page.screenshot({ path: out + 'inv-2-hand-off.png' });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(600);
  const lOn2 = await lum(page);
  const sOn2 = await st(page);
  ok('F: фонарь гаснет — центр кадра темнее; F ещё раз — снова светлее', lOn > lOff * 1.4 + 3 && lOn2 > lOff * 1.4 + 3 && !sOff.hotbar.slots[0].on && sOn2.hotbar.slots[0].on && !sOff.slots[0].lit, `вкл ${lOn.toFixed(1)} · выкл ${lOff.toFixed(1)} · вкл ${lOn2.toFixed(1)}`);

  // ═════════ ходьба W vs бег Shift+W — по отрезку хода, который ходьба уже прошла (туда-обратно, разворот взглядом) ═════════
  // Клавиши держит Playwright (как игрок); страница считает путь по кадрам (переносы — не путь) и разворачивает взгляд на
  // конце отрезка — ход длиной ~4.6 м, бегом за 3 с его не хватает.
  const start = s0.pos;
  const LEG = 3.2;
  const run = (page, o) =>
    page.evaluate(
      async ({ secs, leg, untilTired, after }) => {
        const v = window.__rf3d, c = v.fps;
        const frame = () => new Promise((r) => requestAnimationFrame(r));
        const t0 = performance.now();
        let lx = c.position.x, lz = c.position.z, legD = 0, path = 0, turns = 0;
        const samples = [];
        let p3 = null, tired = null, tiredPath = 0;
        for (;;) {
          await frame();
          const t = (performance.now() - t0) / 1000;
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
            turns++;
          }
          const s = v.sprint.state;
          const bar = document.querySelector('.v3-stamina');
          if (!samples.length || t - samples[samples.length - 1].t >= 0.5)
            samples.push({ t: +t.toFixed(2), fps: Math.round(v.engine.getFps()), v: +s.v.toFixed(3), mul: +s.mul.toFixed(2), path: +path.toFixed(2), on: bar?.classList.contains('on'), tired: bar?.classList.contains('tired'), w: bar?.firstElementChild?.style.transform });
          if (p3 === null && t >= 3) p3 = { t, path };
          if (untilTired && !tired && s.exhausted) {
            tired = { t, path, bar: { on: bar?.classList.contains('on'), tired: bar?.classList.contains('tired') } };
            tiredPath = path;
          }
          // после изнеможения — скорость по окну с 0.6 с (сброс разгона и инерция бега — мимо)
          if (tired && !tired.p0 && t - tired.t >= 0.6) tired.p0 = { t, path };
          if (tired && t - tired.t >= after) break;
          if (!untilTired && t >= secs) break;
          if (t > 16) break;
        }
        const t = (performance.now() - t0) / 1000;
        void tiredPath;
        return { p3, samples, turns, tired, after: tired?.p0 ? { v: (path - tired.p0.path) / (t - tired.p0.t), mul: v.sprint.state.mul } : null };
      },
      o,
    );
  await page.keyboard.down('KeyW');
  const walk = await run(page, { secs: 3.05, leg: LEG, untilTired: false, after: 0 });
  await page.keyboard.up('KeyW');
  const vWalk = walk.p3.path / walk.p3.t;
  // назад к началу, тем же взглядом; отдышаться (шкала полна — спрятана)
  await page.evaluate(({ p, yaw }) => {
    const c = window.__rf3d.fps;
    c.position.set(p[0], p[1], p[2]);
    c.rotation.set(0.12, yaw, 0);
    c.cameraDirection.setAll(0);
  }, { p: start, yaw: route.yaw });
  await page.waitForTimeout(1200);
  const bar0 = (await st(page)).bar;
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyW');
  // без скриншотов по ходу: в swiftshader снимок тормозит кадры на секунды — замер был бы не тот
  const sprint = await run(page, { secs: 0, leg: LEG * 1.15, untilTired: true, after: 2.4 });
  const sT = await st(page);
  await page.screenshot({ path: out + 'inv-4-tired.png' });
  await page.keyboard.up('KeyW');
  await page.keyboard.up('Shift');
  // отдышаться и пробежать ещё — снимок шкалы на бегу
  await page.evaluate(({ p, yaw }) => {
    const c = window.__rf3d.fps;
    c.position.set(p[0], p[1], p[2]);
    c.rotation.set(0.12, yaw, 0);
    c.cameraDirection.setAll(0);
  }, { p: start, yaw: route.yaw });
  await page.waitForTimeout(3500);
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(900);
  await page.screenshot({ path: out + 'inv-3-sprint.png' });
  await page.keyboard.up('KeyW');
  await page.keyboard.up('Shift');
  const vRun = sprint.p3.path / sprint.p3.t;
  console.log('ходьба', JSON.stringify(walk.samples));
  console.log('бег', JSON.stringify(sprint.samples), 'разворотов', sprint.turns);
  const sm = sprint.samples.filter((x) => x.t > 0.4 && (!sprint.tired || x.t <= sprint.tired.t));
  ok('бег: шкала выносливости видна и тает', !bar0?.on && sm.length > 2 && sm.every((x) => x.on) && sm[sm.length - 1].v < sm[0].v - 0.3, sm.map((x) => x.v).join(' → '));
  ok('бег: за те же 3 с путь заметно больше, чем пешком', vRun > vWalk * 1.4, `пешком ${walk.p3.path.toFixed(2)} м за ${walk.p3.t.toFixed(2)} с (${vWalk.toFixed(2)} м/с), бегом ${sprint.p3.path.toFixed(2)} м за ${sprint.p3.t.toFixed(2)} с (${vRun.toFixed(2)} м/с, ×${(vRun / vWalk).toFixed(2)})`);
  ok('изнеможение: ~7 с бега — шкала красная', !!sprint.tired && sprint.tired.bar.tired && sprint.tired.t > 5.5 && sprint.tired.t < 8.5 && sT.bar?.tired, sprint.tired ? `через ${sprint.tired.t.toFixed(1)} с, ${JSON.stringify(sprint.tired.bar)}` : 'не выдохся');
  ok('выдохся: Shift+W зажаты, а скорость — шаг', !!sprint.after && sprint.after.mul < 1.05 && sprint.after.v < vWalk * 1.15, sprint.after ? `${sprint.after.v.toFixed(2)} м/с при ходьбе ${vWalk.toFixed(2)} м/с, mul ${sprint.after.mul}` : '');

  // ═════════ G: фонарь на пол ═════════
  await page.evaluate((p) => {
    const c = window.__rf3d.fps;
    c.position.set(p[0], p[1], p[2]);
    c.cameraDirection.setAll(0);
  }, start);
  await page.evaluate((yaw) => window.__rf3d.fps.rotation.set(0.35, yaw, 0), route.yaw);
  await page.waitForTimeout(1500);
  const lBefore = await lum(page);
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(900);
  const g1 = await st(page);
  console.log('брошен', JSON.stringify(g1.drops), 'ноги', g1.feet.toFixed(3));
  ok('G: фонарь на полу (drops 1, у ног по высоте), ячейка 1 пуста, в руке ничего', g1.drops.length === 1 && g1.drops[0].item === 'it_flashlight' && g1.drops[0].on === true && Math.abs(g1.drops[0].y - g1.feet) < 0.15 && !g1.slots[0].glyph && !g1.flash.held, JSON.stringify(g1.drops[0]));
  // отойти назад и посмотреть на него — лежит на полу, светит
  await page.evaluate((d) => {
    const c = window.__rf3d.fps;
    const yaw = c.rotation.y;
    c.position.set(d.x - Math.sin(yaw) * 1.25, c.position.y, d.z - Math.cos(yaw) * 1.25);
    c.rotation.x = 0.55;
    c.cameraDirection.setAll(0);
  }, g1.drops[0]);
  await page.waitForTimeout(1200);
  const g2 = await st(page);
  const lDropped = await lum(page);
  await page.screenshot({ path: out + 'inv-5-dropped.png' });
  await page.screenshot({ path: out + 'inv-5z-prompt.png', clip });
  ok('лежащий фонарь подсвечен, подсказка «E — подобрать: Фонарик»', g2.aimed === g1.drops[0].id && g2.prompt.length === 1 && g2.prompt[0] === 'E — подобрать: Фонарик', JSON.stringify(g2.prompt));
  console.log('яркость центра: фонарь в руке', lBefore.toFixed(1), '· лежит на полу', lDropped.toFixed(1));
  const lay = await layout(page);
  console.log('раскладка', JSON.stringify(lay.boxes));
  ok('HUD: подсказка, хотбар, шкала, подсказки управления не налезают', lay.hits.length === 0, lay.hits.join(', '));
  // крупно: фонарь на полу
  await page.evaluate((d) => {
    const c = window.__rf3d.fps;
    const yaw = c.rotation.y;
    c.position.set(d.x - Math.sin(yaw) * 0.7, c.position.y, d.z - Math.cos(yaw) * 0.7);
    c.rotation.x = 0.95;
  }, g1.drops[0]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: out + 'inv-6-dropped-close.png' });
  // вдоль луча лежащего фонаря: впереди пятно света (яркость центра кадра — с ним и без него)
  await page.evaluate((d) => {
    const c = window.__rf3d.fps;
    c.position.set(d.x - Math.sin(d.yaw) * 0.45, c.position.y, d.z - Math.cos(d.yaw) * 0.45);
    c.rotation.set(0.32, d.yaw, 0);
  }, g1.drops[0]);
  await page.waitForTimeout(900);
  const lBeam = await lum(page);
  const litN = await page.evaluate(() => window.__rfInv.items.litCount);
  await page.screenshot({ path: out + 'inv-6b-beam.png' });
  await page.evaluate(() => {
    const i = window.__rfInv.inv;
    i.qaDrops = i.host.drops;
    i.host.drops = () => [];
  });
  await page.waitForTimeout(700);
  const lNoBeam = await lum(page);
  await page.evaluate(() => {
    const i = window.__rfInv.inv;
    i.host.drops = i.qaDrops;
  });
  ok('лежащий горящий фонарь светит: впереди светлее, чем без него', litN === 1 && lBeam > lNoBeam * 1.15 + 2, `с ним ${lBeam.toFixed(1)} · без него ${lNoBeam.toFixed(1)} · источников ${litN}`);
  // сбоку, на четвереньках (C), — лежит на полу: не висит и не утонул
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(900);
  await page.evaluate((d) => {
    const c = window.__rf3d.fps;
    const sx = Math.cos(d.yaw), sz = -Math.sin(d.yaw);
    c.position.set(d.x + sx * 0.75, c.position.y, d.z + sz * 0.75);
    c.cameraDirection.setAll(0);
    const eye = c.position.clone();
    c.rotation.set(Math.atan2(eye.y - d.y - 0.02, 0.75), Math.atan2(-sx, -sz), 0);
  }, g1.drops[0]);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: out + 'inv-6c-side.png' });
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(1200);
  await page.evaluate((d) => {
    const c = window.__rf3d.fps;
    c.position.set(d.x - Math.sin(d.yaw) * 0.7, c.position.y, d.z - Math.cos(d.yaw) * 0.7);
    c.rotation.set(0.95, d.yaw, 0);
  }, g1.drops[0]);
  await page.waitForTimeout(700);

  // ═════════ E: подобрать ═════════
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(700);
  const e1 = await st(page);
  ok('E: фонарик снова в руке (ячейка 1, горит), на полу пусто, подсказки нет', e1.drops.length === 0 && e1.hotbar.slots[0]?.item === 'it_flashlight' && e1.hotbar.slots[0]?.on && e1.flash.held && e1.prompt.length === 0, JSON.stringify(e1.hotbar.slots[0]));

  // ═════════ ячейка 2 — пусто в руке; колесо ═════════
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(500);
  const k2 = await st(page);
  await page.screenshot({ path: out + 'inv-7-slot2-empty.png' });
  ok('2: выбрана пустая ячейка — фонаря в руке нет (и света)', k2.hotbar.sel === 1 && k2.slots[1].sel && !k2.flash.held && k2.flash.intensity === 0, JSON.stringify(k2.flash));
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(400);
  const k1 = await st(page);
  await page.screenshot({ path: out + 'inv-7z-held.png', clip });
  ok('1: над хотбаром — имя предмета в руке', k1.held === 'Фонарик', String(k1.held));
  ok('1: снова фонарь в руке', k1.hotbar.sel === 0 && k1.flash.held);
  if (k1.locked) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(300);
    const w1 = await st(page);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(300);
    const w2 = await st(page);
    ok('колесо: следующая ячейка / назад', w1.hotbar.sel === 1 && w2.hotbar.sel === 0, `${w1.hotbar.sel} → ${w2.hotbar.sel}`);
  } else console.log('колесо: мышь не захвачена (headless) — пропуск');

  // ═════════ G и перезагрузка: лежит там же, хотбар тот же ═════════
  await page.evaluate(() => (window.__rf3d.fps.rotation.x = 0.4));
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(1500); // автосохранение мира — через 0.4 с
  const r0 = await st(page);
  await page.reload({ timeout: 180000 });
  await page.waitForTimeout(800);
  if (!(await page.evaluate(() => !!window.__rf3d))) await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rfWalk && window.__rfInv && window.__rf3dFold?.portal?.isActive && window.__rf3d?.props?.ready, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  const r1 = await st(page);
  console.log('до перезагрузки', JSON.stringify(r0.drops), 'после', JSON.stringify(r1.drops));
  ok('перезагрузка: фонарь лежит там же', r1.drops.length === 1 && r0.drops.length === 1 && r1.drops[0].id === r0.drops[0].id && r1.drops[0].x === r0.drops[0].x && r1.drops[0].z === r0.drops[0].z);
  ok('перезагрузка: хотбар тот же (ячейка 1 пуста)', JSON.stringify(r1.hotbar) === JSON.stringify(r0.hotbar) && !r1.slots[0].glyph && !r1.flash.held, JSON.stringify(r1.hotbar));
  await page.evaluate((d) => {
    const c = window.__rf3d.fps;
    const yaw = Math.atan2(d.x - c.position.x, d.z - c.position.z);
    // на предмет: угол вниз — по высоте глаза над ним и расстоянию (чуть выше — он ниже середины кадра)
    c.rotation.set(Math.atan2(c.position.y - d.y, Math.hypot(d.x - c.position.x, d.z - c.position.z)) - 0.12, yaw, 0);
  }, r1.drops[0]);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: out + 'inv-8-reloaded.png' });
  const r2 = await st(page);
  if (r2.aimed) {
    await canvas.click({ position: { x: 300, y: 300 } });
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(700);
    const r3 = await st(page);
    ok('после перезагрузки — подобрать E', r3.drops.length === 0 && r3.hotbar.slots[0]?.item === 'it_flashlight');
  } else ok('после перезагрузки фонарь под взглядом', false, JSON.stringify({ pos: r2.pos, d: r1.drops[0] }));
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
