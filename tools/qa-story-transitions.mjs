// QA переходов сюжета в 3D (docs/LOCATIONS.md §15–17): мир сюжета «Прогулки» (WalkOptions.story), как игрок —
// клавиши и скриншоты:
//  A (срыв): хрущёвка → переход-лестница → в сцене Хвататель утащил → тьма, «Очнуться» → общага (биом obshaga),
//    вспышка «Общага»;
//  B (люк): лестница → подвал → лифт, верхний этаж → сарай → переход «Люк в погреб»: подойти, «E — открыть люк», E —
//    крышка, затемнение → погреб (биом cellar), вспышка «Погреб»;
//  C (дверь в снег): в погребе переход «Дверь в снег»: подойти, «E — открыть дверь», E — дверь, треск, обвал, засыпало;
//    E × digs — выбрался в снежных тоннелях (биом snow).
// Путь между биомами — операциями мира сессии (как у страницы), кроме проверяемых переходов.
//
//   node tools/qa-story-transitions.mjs [--port 5292]   (vite уже запущен; скриншоты — tmp/story-*.png)
// Правки других сессий в дереве перезагружают модули посреди проверки — тогда снимок сборки:
//   NODE_ENV=development npx vite build --mode development --outDir tmp/qa-story-build
//   npx vite preview --outDir tmp/qa-story-build --port 5292 --strictPort
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ai = process.argv.indexOf('--port');
const PORT = ai > 0 ? Number(process.argv[ai + 1]) : 5292;
const out = fileURLToPath(new URL('../tmp/', import.meta.url));
mkdirSync(out, { recursive: true });
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
const shot = (page, name) => page.screenshot({ path: out + `story-${name}.png` });

const where = (page) =>
  page.evaluate(() => {
    const d = window.__rf3dFold, s = window.__rfWalk, w = s.world;
    const room = d.portal?.current ?? d.current.center;
    const cl = w.clusterAt(room);
    return { room, biome: cl?.biome?.id ?? null, kind: w.locationOf(room)?.kind ?? null, story: s.story, overlay: window.__rf3d.hasOverlay, pose: window.__rf3d.posture.pose, frozen: window.__rf3d.posture.frozen };
  });
const prompt = (page) => page.evaluate(() => [...document.querySelectorAll('.v3-lift-prompt')].map((e) => e.textContent).join(' | '));
/** Вспышки-надписи с начала (журнал MutationObserver: рендер в swiftshader медленный — короткие можно пропустить). */
const flashText = (page) => page.evaluate(() => window.__qaFlashes?.at(-1) ?? null);
const flashLog = () => {
  window.__qaFlashes = [];
  const seen = new WeakSet();
  new MutationObserver(() => {
    for (const e of document.querySelectorAll('.v3-flash')) {
      if (seen.has(e)) continue;
      seen.add(e);
      window.__qaFlashes.push(e.textContent);
    }
  }).observe(document.body, { childList: true, subtree: true });
};
const phase = (page) => page.evaluate(() => window.__rfStory?.phase ?? null);

/**
 * Найти/вырастить переход вида kind в биоме игрока: «войти» в комнаты квартиры (счётчик → переход выпал), открыть её
 * закрытый выход (операция door) — за ним встаёт переход. Возвращает id комнаты перехода.
 */
const growTransition = (page, kind) =>
  page.evaluate(async (kind) => {
    const s = window.__rfWalk, w = s.world, d = window.__rf3dFold;
    const have = () => w.run().instances.find((i) => w.locationOf(i.id)?.kind === kind && w.clusterAt(i.id)?.biome?.id === w.clusterAt(d.portal?.current ?? d.current.center)?.biome?.id)?.id ?? null;
    for (let round = 0; round < 12; round++) {
      const found = have();
      if (found) return found;
      const room = d.portal?.current ?? d.current.center;
      const cid = w.clusterAt(room)?.id;
      for (const i of w.run().instances) {
        if (w.transitionState()?.pending) break;
        if (w.clusterAt(i.id)?.id !== cid) continue;
        s.enter(i.id);
      }
      // закрытый выход квартиры игрока → дверь
      const ex = [];
      for (const i of s.rx.instances) {
        if (w.clusterAt(i.id)?.id !== cid) continue;
        for (const k of i.connectors ?? []) if (k.exit) ex.push({ inst: i.id, conn: k.id, len: k.len });
      }
      ex.sort((a, b) => b.len - a.len);
      if (!ex.length) {
        // сеть ходов (подвал, погреб): переход встаёт, когда ход растёт после выпадения — растить вглубь
        const bio = w.clusterAt(room)?.biome?.id;
        const seen = new Set();
        const stack = [room];
        for (let k = 0; k < 3000 && stack.length; k++) {
          if (have()) return have();
          const id = stack[stack.length - 1];
          if (!seen.has(id)) {
            seen.add(id);
            if (!w.transitionState()?.pending) w.enter(id);
            w.expand(id);
          }
          const next = w.run().links.filter((l) => !l.kind && !l.sealed && (l.a.inst === id || l.b.inst === id)).map((l) => (l.a.inst === id ? l.b.inst : l.a.inst)).filter((x) => !seen.has(x) && w.clusterAt(x)?.biome?.id === bio);
          if (next.length) stack.push(next[next.length - 1]);
          else stack.pop();
        }
        return have();
      }
      const id = await s.request({ k: 'door', inst: ex[0].inst, conn: ex[0].conn });
      if (have()) return have();
      // за дверью квартира того же биома — перейти в неё и снова
      if (id) {
        await new Promise((r) => setTimeout(r, 60));
        d.goTo(id);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    return have();
  }, kind);

/** Перейти в комнату id (как после перехода) и подождать кусок и спавн (рендер медленный — по кадрам). */
const goRoom = async (page, id) => {
  await page.evaluate(async (id) => {
    const s = window.__rfWalk, d = window.__rf3dFold;
    for (let k = 0; k < 100 && !s.rx.instances.some((i) => i.id === id); k++) await new Promise((r) => setTimeout(r, 20));
    d.goTo(id);
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (let k = 0; k < 200 && (d.portal?.current ?? d.current.center) !== id; k++) await frame();
    for (let k = 0; k < 4; k++) await frame();
  }, id);
  await page.waitForTimeout(300);
};

/** Дождаться фазы сценария ph (не меньше tMin с в ней) и поставить на паузу (скриншот); false — фаза прошла. */
const holdWhen = (page, ph, tMin) =>
  page.evaluate(
    async ({ ph, tMin }) => {
      const q = window.__rfStory;
      let seen = false;
      for (let k = 0; k < 4000; k++) {
        if (q.phase === ph) {
          seen = true;
          if ((q.t ?? 0) >= tMin) {
            q.hold(true);
            return true;
          }
        } else if (seen) return false;
        await new Promise((r) => setTimeout(r, 3));
      }
      return false;
    },
    { ph, tMin },
  );
const release = (page) => page.evaluate(() => window.__rfStory.hold(false));
/** Пауза держится, а кадр рисуется: дать кадру отрисовать позу и снять. */
const heldShot = async (page, name) => {
  await page.evaluate(async () => {
    for (let k = 0; k < 3; k++) await new Promise((r) => requestAnimationFrame(() => r()));
  });
  await shot(page, name);
};

/** Камерой — к точке (Babylon x, z), кадрами, как игрок (коллизии). */
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
      return [cam.position.x, cam.position.y, cam.position.z];
    },
    { x, z, frames },
  );

/** Середина комнаты (Babylon) и метка snowdoor (середина проёма, нормаль внутрь — Babylon). */
const roomGeo = (page, id) =>
  page.evaluate((id) => {
    const s = window.__rfWalk, i = s.rx.instances.find((x) => x.id === id), cm = s.rx.cellM, b = i.bbox;
    const k = i.connectors.find((c) => c.id === 'snowdoor');
    let door = null;
    if (k) {
      const along = k.side === 'N' || k.side === 'S';
      const line = k.side === 'N' ? k.cy : k.side === 'S' ? k.cy + 1 : k.side === 'W' ? k.cx : k.cx + 1;
      const sg = k.side === 'N' || k.side === 'W' ? -1 : 1;
      const mid = ((along ? k.cx : k.cy) + k.len / 2) * cm;
      const px = along ? mid : line * cm, py = along ? line * cm : mid;
      const nx = along ? 0 : -sg, ny = along ? -sg : 0;
      door = { x: px, z: -py, ux: nx, uz: -ny, side: k.side, len: k.len, exit: !!k.exit, arrival: !!k.arrival };
    }
    return { cx: ((b.x0 + b.x1) / 2) * cm, cz: -((b.y0 + b.y1) / 2) * cm, z0: Number(i.z) || 0, roomId: i.roomId, door, decor: i.decor.map((d) => d.propId) };
  }, id);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|AudioContext/i.test(m.text()) && errors.push(m.text().slice(0, 300)));

  // ── мир сюжета ──
  // проект — пресеты (первый запуск кладёт их в localStorage); переход — через 2 комнаты (правка сохранённого проекта:
  // работает и в снимке сборки SNAP, где модулей по путям нет)
  await go(page, BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ timeout: 180000 });
  await page.waitForFunction(() => !!localStorage.getItem('room-forge/project/v1'), null, { timeout: 60000 });
  await page.evaluate(() => {
    const o = JSON.parse(localStorage.getItem('room-forge/project/v1'));
    if (o.world) Object.assign(o.world, { trAfter: 2, trBase: 1, trStep: 0 });
    localStorage.setItem('room-forge/project/v1', JSON.stringify(o));
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-story-3d', deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, biome: null, story: true, on: true }));
  });
  await page.reload({ timeout: 180000 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => (window.__rfLiftSpec = { boardChance: 0, boardFirst: false }));
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.evaluate(flashLog);
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rfStory, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  const w0 = await where(page);
  ok('старт: мир сюжета, хрущёвка', w0.story && w0.biome === 'khrush', JSON.stringify(w0));
  const f0 = await flashText(page);
  ok('старт: вспышка «Хрущёвка»', f0 === 'Хрущёвка', String(f0));
  await shot(page, '0-start');

  // ═════════════════ A: срыв на лестнице → общага ═════════════════
  const stair = await growTransition(page, 'stairwell');
  ok('A в хрущёвке встал переход-лестница', !!stair, String(stair));
  if (stair) {
    await goRoom(page, stair);
    await page.waitForFunction(() => window.__rfStair?.ready, null, { timeout: 120000 }).catch(() => {});
    const inStair = await page.evaluate(() => !!window.__rfStair?.ready);
    ok('A сцена лестницы', inStair);
    const dbg = await page.evaluate(() => [...document.querySelectorAll('.v3-loc-tools label')].map((l) => l.textContent));
    ok('A в сюжете нет чекбокса «отладка»', !dbg.some((t) => /отладка/.test(t)), JSON.stringify(dbg));
    if (inStair) {
      // Хвателя «вызвать»: событие механики grabbed → ролик → смерть
      await page.evaluate(() => {
        const s = window.__rfStair;
        s.qaStart();
        s.onEvent({ type: 'grabbed' });
        s.advance(1.2);
      });
      await shot(page, 'A0-grab');
      // смерть → экран срыва; текст — сразу, как появился (рендер в swiftshader медленный: 2.5 с проходят быстро)
      const fallTxt = await page.evaluate(async () => {
        window.__rfStair.advance(2);
        for (let k = 0; k < 400; k++) {
          const e = document.querySelector('.v3-story-fall') ?? document.querySelector('.v3-loc-dead');
          if (e) return e.className + ': ' + e.textContent;
          await new Promise((r) => setTimeout(r, 10));
        }
        return null;
      });
      ok('A утащили — тьма и «Очнуться» (не «Ещё раз»)', !!fallTxt && /Очнуться/.test(fallTxt) && !/Ещё раз/.test(fallTxt), String(fallTxt));
      await shot(page, 'A1-grabbed');
      // ждём срыв сам (2.5 с)
      await page.waitForFunction(() => !window.__rf3d.hasOverlay, null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const wa = await where(page);
      ok('A очнулся в общаге', wa.biome === 'obshaga' && !wa.overlay, JSON.stringify(wa));
      const fa = await flashText(page);
      ok('A вспышка «Общага»', fa === 'Общага', String(fa));
      await shot(page, 'A2-obshaga');

      // ═════════════════ D: общага → дверь в снег ═════════════════
      const od = wa.biome === 'obshaga' ? await growTransition(page, 'snowdoor') : null;
      ok('D в общаге встала «Дверь в снег»', !!od, String(od));
      if (od) {
        await goRoom(page, od);
        const go = await roomGeo(page, od);
        const D = go.door;
        ok('D метка snowdoor на стене', !!D, JSON.stringify(D));
        if (D) {
          await page.evaluate(({ D }) => {
            const c = window.__rf3d.fps;
            c.position.x = D.x + D.ux * 1.0;
            c.position.z = D.z + D.uz * 1.0;
            c.rotation.set(0.05, Math.atan2(-D.ux, -D.uz), 0);
          }, { D });
          await page.waitForTimeout(800);
          const prD = await prompt(page);
          ok('D у двери общаги — одна подсказка «E — открыть дверь»', prD === 'E — открыть дверь', prD);
          await shot(page, 'D0-obshaga-door');
          await page.keyboard.press('KeyE');
          if (await holdWhen(page, 'snowdoor:crack', 0.8)) {
            await heldShot(page, 'D1-obshaga-crack');
            const prC = await prompt(page);
            ok('D треск — чужих подсказок «E — …» нет', prC === '', prC);
            await release(page);
          }
          await page.waitForFunction(() => window.__rfStory?.phase === 'snowdoor:buried', null, { timeout: 10000 }).catch(() => {});
          const needD = await page.evaluate((id) => window.__rfWalk.world.locationOf(id).roll.digs, od);
          for (let k = 0; k < needD; k++) {
            await page.keyboard.press('KeyE');
            await page.waitForTimeout(150);
          }
          await page.waitForFunction(() => window.__rfStory?.phase === null, null, { timeout: 20000 }).catch(() => {});
          await page.waitForTimeout(500);
          const wD = await where(page);
          ok('D из общаги — в снежные тоннели', wD.biome === 'snow' && wD.pose === 'crawl', JSON.stringify(wD));
          await shot(page, 'D2-snow');
        }
      }
    }
  }

  // ═════════════════ B: люк в погреб ═════════════════
  // хрущёвка → (лестница: операция мира) подвал → (лифт, верхний этаж) сарай
  let hatch = null;
  if (stair) {
    const bsm = await page.evaluate((id) => window.__rfWalk.request({ k: 'descend', id }), stair);
    await goRoom(page, bsm);
    const wb = await where(page);
    ok('B лестница вывела в подвал', wb.biome === 'basement', JSON.stringify(wb));
    const lift = await growTransition(page, 'lift');
    ok('B в подвале встал лифт', !!lift, String(lift));
    if (lift) {
      // ═════════════════ E: срыв в лифте → общага ═════════════════
      await goRoom(page, lift);
      await page.waitForFunction(() => window.__rfLift?.ready, null, { timeout: 120000 }).catch(() => {});
      if (await page.evaluate(() => !!window.__rfLift?.ready)) {
        const dbgL = await page.evaluate(() => [...document.querySelectorAll('.v3-loc-tools label')].map((l) => l.textContent));
        ok('E в сюжете у лифта нет чекбокса «отладка»', !dbgL.some((t) => /отладка/.test(t)), JSON.stringify(dbgL));
        const liftTxt = await page.evaluate(async () => {
          const s = window.__rfLift;
          s.qaStart();
          s.drop = { t: 0, y0: s.state.y };
          s.advance(3);
          for (let k = 0; k < 400; k++) {
            const e = document.querySelector('.v3-story-fall') ?? document.querySelector('.v3-loc-dead');
            if (e) return e.className + ': ' + e.textContent;
            await new Promise((r) => setTimeout(r, 10));
          }
          return null;
        });
        ok('E трос оборвался — тьма и «Очнуться»', !!liftTxt && /story-fall/.test(liftTxt) && /Трос оборвался/.test(liftTxt) && /Очнуться/.test(liftTxt), String(liftTxt));
        await shot(page, 'E0-lift-snap');
        // «Очнуться» — кнопкой, не дожидаясь 2.5 с
        await page.locator('.v3-story-fall button').click({ timeout: 5000 }).catch(() => {});
        await page.waitForFunction(() => !window.__rf3d.hasOverlay, null, { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(800);
        const wE = await where(page);
        ok('E очнулся в общаге', wE.biome === 'obshaga' && !wE.overlay, JSON.stringify(wE));
        await shot(page, 'E1-obshaga');
      } else ok('E сцена лифта', false);
      const barn = await page.evaluate((id) => {
        const s = window.__rfWalk, roll = s.world.locationOf(id).roll;
        return s.request({ k: 'ascend', id, floor: roll.floors, side: 'straight' });
      }, lift);
      await goRoom(page, barn);
      const wc = await where(page);
      ok('B лифт (верхний этаж) вывел в сарай', wc.biome === 'barn', JSON.stringify(wc));
      hatch = await growTransition(page, 'hatch');
      ok('B в сарае встал «Люк в погреб»', !!hatch, String(hatch));
    }
  }
  if (hatch) {
    // комната люка: встать у входа, подойти к люку как игрок
    await goRoom(page, hatch);
    const g = await roomGeo(page, hatch);
    ok('B комната люка: проп люка посреди', g.decor.includes('p_cellar_hatch'), JSON.stringify(g.decor));
    // со стороны кольца (свободный край крышки; петли — на дальней стороне от вошедшего): yaw — у убранства люка
    const yaw = (await page.evaluate((id) => window.__rfStory.info(id)?.yaw ?? 0, hatch)) || 0;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    await page.evaluate(({ cx, cz, fx, fz }) => {
      const c = window.__rf3d.fps;
      c.position.x = cx + fx * 1.25;
      c.position.z = cz + fz * 1.25;
      c.rotation.set(0.35, Math.atan2(-fx, -fz), 0);
    }, { ...g, fx, fz });
    await page.waitForTimeout(700);
    await shot(page, 'B0-hatch-room');
    await camWalk(page, g.cx + fx * 0.95, g.cz + fz * 0.95, 120);
    await page.evaluate(({ cx, cz }) => {
      const c = window.__rf3d.fps;
      c.rotation.set(0.75, Math.atan2(cx - c.position.x, cz - c.position.z), 0);
    }, g);
    await page.waitForTimeout(600);
    const pr = await prompt(page);
    ok('B у люка — «E — открыть люк»', /открыть люк/.test(pr), pr);
    await shot(page, 'B1-hatch-prompt');
    console.log('люк (закрыт):', JSON.stringify(await page.evaluate((id) => window.__rfStory.info(id), hatch)));
    console.log('камера:', JSON.stringify(await page.evaluate(() => { const c = window.__rf3d.fps; return [c.position.x, c.position.y, c.position.z, c.rotation.x, c.rotation.y]; })));
    await page.locator('canvas').first().focus().catch(() => {});
    await page.keyboard.press('KeyE');
    const h1 = await holdWhen(page, 'hatch:open', 0.6);
    ok('B E — крышка пошла', h1, String(await phase(page)));
    await heldShot(page, 'B2-lid-opening');
    console.log('люк (открывается):', JSON.stringify(await page.evaluate((id) => window.__rfStory.info(id), hatch)));
    console.log('камера:', JSON.stringify(await page.evaluate(() => { const c = window.__rf3d.fps; return [c.position.x, c.position.y, c.position.z, c.rotation.x, c.rotation.y]; })));
    const fr = await where(page);
    ok('B во время сценария игрок стоит (frozen)', fr.frozen, JSON.stringify(fr));
    // зажатая W — не уходит
    const p0 = await page.evaluate(() => [window.__rf3d.fps.position.x, window.__rf3d.fps.position.z]);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyW');
    const p1 = await page.evaluate(() => [window.__rf3d.fps.position.x, window.__rf3d.fps.position.z]);
    ok('B зажатая W при спуске не двигает', Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 0.05, JSON.stringify([p0, p1]));
    await release(page);
    if (await holdWhen(page, 'hatch:down', 0.55)) {
      await heldShot(page, 'B3-down-into-hole');
      await release(page);
    }
    if (await holdWhen(page, 'hatch:reveal', 0.35)) {
      await heldShot(page, 'B4-reveal');
      await release(page);
    }
    await page.waitForFunction(() => window.__rfStory?.phase === null, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(300);
    const wd = await where(page);
    ok('B спустился в погреб', wd.biome === 'cellar' && !wd.frozen, JSON.stringify(wd));
    const fd = await flashText(page);
    ok('B вспышка «Погреб»', fd === 'Погреб', String(fd));
    await shot(page, 'B5-cellar');

    // ═════════════════ C: дверь в снег ═════════════════
    const sd = await growTransition(page, 'snowdoor');
    ok('C в погребе встала «Дверь в снег»', !!sd, String(sd));
    if (sd) {
      await goRoom(page, sd);
      const gs = await roomGeo(page, sd);
      ok('C метка snowdoor на стене', !!gs.door, JSON.stringify(gs.door));
      if (gs.door) {
        const D = gs.door;
        // встать в 1.8 м от двери, подойти на 1 м
        await page.evaluate(({ D }) => {
          const c = window.__rf3d.fps;
          c.position.x = D.x + D.ux * 1.8;
          c.position.z = D.z + D.uz * 1.8;
          c.rotation.set(0.05, Math.atan2(-D.ux, -D.uz), 0);
        }, { D });
        await page.waitForTimeout(700);
        await shot(page, 'C0-door');
        await camWalk(page, D.x + D.ux * 1.0, D.z + D.uz * 1.0, 120);
        await page.evaluate(({ D }) => window.__rf3d.fps.rotation.set(0.05, Math.atan2(-D.ux, -D.uz), 0), { D });
        await page.waitForTimeout(500);
        const pr2 = await prompt(page);
        ok('C у двери — «E — открыть дверь» (одна подсказка)', pr2 === 'E — открыть дверь', pr2);
        await page.keyboard.press('KeyE');
        if (await holdWhen(page, 'snowdoor:open', 1.0)) {
          await heldShot(page, 'C1-door-open-snow');
          await release(page);
        }
        const h2 = await holdWhen(page, 'snowdoor:crack', 1.1);
        ok('C треск', h2, String(await phase(page)));
        if (h2) {
          await heldShot(page, 'C2-crack');
          await release(page);
        }
        if (await holdWhen(page, 'snowdoor:fall', 0.3)) {
          await heldShot(page, 'C2b-fall');
          await release(page);
        }
        await page.waitForFunction(() => window.__rfStory?.phase === 'snowdoor:buried', null, { timeout: 8000 }).catch(() => {});
        const pr3 = await prompt(page);
        const white = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.v3-snow-buried') ?? document.body).opacity));
        ok('C засыпало: пелена, «E — выкапываться»', /выкапываться/.test(pr3) && white > 0.9, `${pr3} · пелена ${white}`);
        await shot(page, 'C3-buried');
        const need = await page.evaluate((id) => window.__rfWalk.world.locationOf(id).roll.digs, sd);
        const whites = [];
        for (let k = 0; k < need; k++) {
          await page.keyboard.press('KeyE');
          await page.waitForTimeout(220);
          whites.push(await page.evaluate(() => Number(document.querySelector('.v3-snow-buried')?.style.opacity ?? -1)));
          if (k === Math.floor(need / 2)) await shot(page, 'C4-digging');
        }
        ok('C каждое нажатие убирает пелену', whites.slice(0, -1).every((w, i) => i === 0 || w < whites[i - 1] + 1e-6), JSON.stringify(whites));
        if (await holdWhen(page, 'snowdoor:rise', 0.35)) {
          await heldShot(page, 'C5-rise');
          await release(page);
        }
        await page.waitForFunction(() => window.__rfStory?.phase === null, null, { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(600);
        const ws = await where(page);
        ok('C выбрался в снежных тоннелях (на четвереньках)', ws.biome === 'snow' && ws.pose === 'crawl' && !ws.frozen, JSON.stringify(ws));
        const fs = await flashText(page);
        ok('C вспышка «Снежные тоннели»', fs === 'Снежные тоннели', String(fs));
        await shot(page, 'C6-snow');
        // ползёт как игрок
        const q0 = await page.evaluate(() => [window.__rf3d.fps.position.x, window.__rf3d.fps.position.z]);
        await page.keyboard.down('KeyW');
        await page.waitForTimeout(1200);
        await page.keyboard.up('KeyW');
        const q1 = await page.evaluate(() => [window.__rf3d.fps.position.x, window.__rf3d.fps.position.z]);
        ok('C зажатая W — ползёт', Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) > 0.05, JSON.stringify([q0, q1]));
        await shot(page, 'C7-crawl');
      }
    }
  }
} catch (e) {
  console.error(e);
  ok('скрипт без исключений', false, String(e?.message ?? e));
} finally {
  await browser.close();
}
if (errors.length) console.log('ошибки страницы:\n' + errors.slice(0, 20).join('\n'));
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} OK`);
process.exit(bad.length ? 1 : 0);
