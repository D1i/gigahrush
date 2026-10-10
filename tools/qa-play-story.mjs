// QA «Запустить без отладки» сквозь сюжет (src/play/PlayPage.tsx, docs/GAMEPLAY.md «Запуск без отладки», src/game/story.ts),
// как игрок: меню → «Одиночная игра» → «Новая игра» → «Войти»; нажатия — клавишами. Проверяет:
//  0. нет отладочных панелей; экран входа — мир за ним (прогрев), игра на паузе; «Войти» → вспышка «Хрущёвка»;
//  1. пауза (мышь отпущена = Esc браузера): кадры стоят, W не двигает, окно без фокуса — тоже пауза; «Продолжить»;
//  2. лестница: пауза — время сцены стоит, кнопка «Меню», Esc — меню паузы; Хвателя «вызвали» и отпустили мышь —
//     за 4 с паузы не утащил; захват мыши — утащил → «Очнуться» → общага (срыв), вспышка «Общага» — после паузы;
//  3. общага: отключение света — время режиссёра на паузе стоит;
//  4. лестница → (выход вниз ногами: сцена отпускает мышь, страница захватывает снова) подвал, без паузы на выходе;
//  5. лифт: пауза — раскачка стоит; выход на верхнем этаже → сарай;
//  6. «Люк в погреб»: подойти (W), «E — открыть люк», E; пауза посреди сценария — фаза стоит; → погреб;
//  7. «Дверь в снег»: подойти (W), E, треск, обвал, E × digs → снежные тоннели (на четвереньках);
//  8. снег → (ангар: операция мира) завод → болото (переход сюжета завода; нет — «где влажнее»): пауза в зале, встать на
//     зуб → титры «КОНЕЦ», кнопки «Новая игра» / «Главное меню» → «Главное меню» → меню.
// Переходы между биомами, которых нет в проверке, — операциями мира (как у страницы), trAfter = 2 (правка сохранённого
// проекта). Скриншоты — tmp/qa-play-story-*.png.
//   node tools/qa-play-story.mjs [--port 5293] [--snap tmp/<сборка>] [--config tmp/<vite-конфиг>.ts] [--keep-server]
// Другие сессии правят дерево — снимок сборки (--snap):
//   NODE_ENV=development npx vite build --mode development --outDir tmp/qa-play-story-build
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};
const PORT = Number(arg('--port') ?? 5293);
const SNAP = arg('--snap');
const CFG = arg('--config');
const keep = process.argv.includes('--keep-server');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('../tmp/', import.meta.url));
mkdirSync(out, { recursive: true });

const cmd = SNAP
  ? `npx vite preview --outDir ${SNAP} --port ${PORT} --strictPort`
  : `npx vite --port ${PORT} --strictPort --config ${CFG ?? 'tools/vite.qa.config.ts'}`;
const server = spawn(cmd, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
const stopServer = () => {
  if (keep) return;
  try {
    // синхронно: асинхронный taskkill обрывается process.exit, и сервер остаётся жить
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: out + `qa-play-story-${name}.png` });

// ── состояние страницы ──
const where = (page) =>
  page.evaluate(() => {
    const d = window.__rf3dFold, s = window.__rfWalk, w = s.world;
    const room = d.portal?.current ?? d.current.center;
    const cl = w.clusterAt(room);
    const v = window.__rf3d;
    return { room, biome: cl?.biome?.id ?? null, kind: w.locationOf(room)?.kind ?? null, story: s.story, overlay: v.hasOverlay, pose: v.posture.pose, frozen: v.posture.frozen };
  });
const st = (page) =>
  page.evaluate(() => {
    const v = window.__rf3d;
    return {
      locked: !!document.pointerLockElement,
      paused: window.__rfPaused === true,
      vPaused: !!v?.paused,
      frame: v?.scene.getFrameId() ?? -1,
      pos: v ? [+v.fps.position.x.toFixed(3), +v.fps.position.z.toFixed(3)] : null,
      card: !!document.querySelector('.v3-pause'),
      cardTitle: document.querySelector('.v3-pause h2')?.textContent ?? null,
      menuBtn: !!document.querySelector('.v3-play-menu'),
    };
  });
const prompt = (page) => page.evaluate(() => [...document.querySelectorAll('.v3-lift-prompt')].map((e) => e.textContent).join(' | '));
const flashes = (page) => page.evaluate(() => window.__qaFlashes ?? []);
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
/** Esc браузера: мышь отпущена (в безголовом Chrome Esc её не отпускает — как браузер, через exitPointerLock). */
const releaseMouse = async (page) => {
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => !document.pointerLockElement, null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__rf3d?.paused, null, { timeout: 3000 }).catch(() => {});
  await sleep(150);
};
const waitLocked = (page, ms = 5000) => page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: ms }).then(() => true, () => false);
/** Кнопка меню паузы («Продолжить» / «Войти») — мышью, как игрок; ждать захвата. */
const resume = async (page, name = 'Продолжить') => {
  await page.getByRole('button', { name, exact: true }).click({ timeout: 10000 });
  return waitLocked(page);
};
/** Спец-локация: «Клик — захватить мышь» (подсказка сцены) или клик по холсту. */
const clickScene = async (page) => {
  const hint = page.locator('.v3-loc-hint');
  if (await hint.isVisible().catch(() => false)) await hint.click();
  else await page.mouse.click(640, 400);
  return waitLocked(page);
};
/** Подождать n кадров прогулки (рендер медленный). */
const frames = (page, n) =>
  page.evaluate(async (n) => {
    for (let k = 0; k < n; k++) await new Promise((r) => requestAnimationFrame(() => r()));
  }, n);

/** Найти/вырастить переход вида kind в биоме игрока (как tools/qa-story-transitions.mjs). */
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
      const ex = [];
      for (const i of s.rx.instances) {
        if (w.clusterAt(i.id)?.id !== cid) continue;
        for (const k of i.connectors ?? []) if (k.exit) ex.push({ inst: i.id, conn: k.id, len: k.len });
      }
      ex.sort((a, b) => b.len - a.len);
      if (!ex.length) {
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
      if (id) {
        await new Promise((r) => setTimeout(r, 60));
        d.goTo(id);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    return have();
  }, kind);

/** Перейти в комнату id (как после перехода) и подождать кусок (рисуется только без паузы — мышь захвачена). */
const goRoom = async (page, id) => {
  await page.evaluate(async (id) => {
    const s = window.__rfWalk, d = window.__rf3dFold;
    for (let k = 0; k < 100 && !s.rx.instances.some((i) => i.id === id); k++) await new Promise((r) => setTimeout(r, 20));
    d.goTo(id);
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (let k = 0; k < 300 && (d.portal?.current ?? d.current.center) !== id; k++) await frame();
    for (let k = 0; k < 4; k++) await frame();
  }, id);
  await sleep(300);
};

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
      door = { x: px, z: -py, ux: nx, uz: -ny };
    }
    return { cx: ((b.x0 + b.x1) / 2) * cm, cz: -((b.y0 + b.y1) / 2) * cm, hx: (Math.abs(b.x1 - b.x0) * cm) / 2, hz: (Math.abs(b.y1 - b.y0) * cm) / 2, door };
  }, id);

/** Встать в точку (Babylon x, z) лицом к (tx, tz) — «пришёл сюда». */
const stand = (page, x, z, tx, tz, pitch = 0.05) =>
  page.evaluate(({ x, z, tx, tz, pitch }) => {
    const c = window.__rf3d.fps;
    c.position.x = x;
    c.position.z = z;
    c.rotation.set(pitch, Math.atan2(tx - x, tz - z), 0);
    c.cameraDirection.setAll(0);
  }, { x, z, tx, tz, pitch });

/** Идти вперёд (зажатая W), пока не появится подсказка re (не дольше ms); true — появилась. */
const walkUntilPrompt = async (page, re, ms = 9000) => {
  await page.locator('canvas').first().focus().catch(() => {});
  await page.keyboard.down('KeyW');
  let seen = false;
  for (let t = 0; t < ms && !seen; t += 100) {
    await sleep(100);
    seen = re.test(await prompt(page));
  }
  await page.keyboard.up('KeyW');
  await sleep(300);
  return seen || re.test(await prompt(page));
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|AudioContext|ERR_CONNECTION_REFUSED|steam/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
  for (let k = 0; ; k++) {
    try {
      await page.goto(BASE, { timeout: 180000 });
      break;
    } catch (e) {
      if (k >= 4) throw e;
      await sleep(3000);
    }
  }
  // проект — пресеты (первый запуск кладёт их в localStorage); переход сюжета — через 2 комнаты
  await page.evaluate(() => localStorage.clear());
  await page.reload({ timeout: 180000 });
  await page.waitForFunction(() => !!localStorage.getItem('room-forge/project/v1'), null, { timeout: 60000 });
  await page.evaluate(() => {
    const o = JSON.parse(localStorage.getItem('room-forge/project/v1'));
    if (o.world) Object.assign(o.world, { trAfter: 2, trBase: 1, trStep: 0 });
    localStorage.setItem('room-forge/project/v1', JSON.stringify(o));
  });
  await page.reload({ timeout: 180000 });
  await page.waitForTimeout(800);
  await page.evaluate(flashLog);

  // ═════════════════ 0. меню → новая игра → вход ═════════════════
  await page.getByRole('button', { name: '▶ Запустить без отладки' }).click();
  await page.waitForSelector('.play-board', { timeout: 60000 });
  await page.getByRole('menuitem', { name: 'Одиночная игра' }).click();
  await page.getByRole('menuitem', { name: 'Новая игра' }).click();
  const confirm = page.getByRole('menuitem', { name: 'Да, новая игра' });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rfStory, null, { timeout: 180000 });
  await sleep(2500);
  const w0 = await where(page);
  ok('0 мир сюжета, старт в хрущёвке', w0.story && w0.biome === 'khrush', JSON.stringify(w0));
  ok('0 отладки нет (панели, инструменты, fps, комната)', !(await page.$('aside.side')) && !(await page.$('.v3-tools')) && !(await page.$('.v3-perf')) && !(await page.$('.v3-here')));
  const s0 = await st(page);
  ok('0 экран входа («Гигахрущ», «Войти»), игра на паузе', s0.card && s0.cardTitle === 'Гигахрущ' && s0.paused && s0.vPaused, JSON.stringify(s0));
  await sleep(1500);
  const s0b = await st(page);
  ok('0 до входа кадры стоят (прогрев прошёл)', s0b.frame === s0.frame || s0b.frame - s0.frame < 3, `${s0.frame} → ${s0b.frame}`);
  ok('0 до входа вспышки «Хрущёвка» нет (будет при входе)', !(await flashes(page)).includes('Хрущёвка'), JSON.stringify(await flashes(page)));
  await shot(page, '00-enter');
  ok('0 «Войти» — мышь захвачена', await resume(page, 'Войти'));
  await sleep(1500);
  const s1 = await st(page);
  ok('0 в игре: пауза снята, кадры идут, меню паузы нет', !s1.paused && !s1.vPaused && s1.frame > s0b.frame && !s1.card, JSON.stringify(s1));
  await page.waitForFunction(() => (window.__qaFlashes ?? []).includes('Хрущёвка'), null, { timeout: 8000 }).catch(() => {});
  ok('0 вспышка «Хрущёвка» при входе', (await flashes(page)).includes('Хрущёвка'), JSON.stringify(await flashes(page)));
  await shot(page, '01-khrush');

  // ═════════════════ 1. пауза в прогулке ═════════════════
  const p0 = (await st(page)).pos;
  await page.keyboard.down('KeyW');
  await sleep(900);
  await page.keyboard.up('KeyW');
  await sleep(200);
  const p1 = (await st(page)).pos;
  ok('1 W — идёт', Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 0.05, JSON.stringify([p0, p1]));
  await releaseMouse(page);
  const a = await st(page);
  ok('1 Esc (мышь отпущена) — меню «Пауза», игра на паузе', a.card && a.cardTitle === 'Пауза' && a.paused && a.vPaused, JSON.stringify(a));
  await page.locator('canvas').first().focus().catch(() => {});
  await page.keyboard.down('KeyW');
  await sleep(1500);
  await page.keyboard.up('KeyW');
  const b = await st(page);
  ok('1 на паузе кадры стоят', b.frame === a.frame, `${a.frame} → ${b.frame}`);
  ok('1 на паузе W не двигает', Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]) < 1e-3, JSON.stringify([a.pos, b.pos]));
  await shot(page, '02-pause');
  ok('1 «Продолжить» — мышь захвачена', await resume(page));
  await sleep(800);
  const c = await st(page);
  ok('1 после паузы кадры идут', !c.paused && c.frame > b.frame && !c.card, JSON.stringify(c));
  // окно без фокуса (мышь захвачена) — тоже пауза
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(300);
  const bl = await st(page);
  await sleep(1000);
  const bl2 = await st(page);
  ok('1 окно без фокуса — пауза, кадры стоят', bl.paused && bl2.frame === bl.frame, JSON.stringify({ bl, f2: bl2.frame }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(600);
  const fo = await st(page);
  ok('1 фокус вернулся (мышь захвачена) — игра идёт', !fo.paused && fo.frame > bl2.frame, JSON.stringify(fo));

  // ═════════════════ 2. лестница: пауза, Хвататель, срыв → общага ═════════════════
  const stair = await growTransition(page, 'stairwell');
  ok('2 в хрущёвке встал переход-лестница', !!stair, String(stair));
  let obshOk = false;
  if (stair) {
    await goRoom(page, stair);
    await page.waitForFunction(() => window.__rfStair?.ready && window.__rfStair.started, null, { timeout: 120000 }).catch(() => {});
    const in2 = await page.evaluate(() => ({ ready: !!window.__rfStair?.ready, started: !!window.__rfStair?.started, locked: !!document.pointerLockElement }));
    ok('2 сцена лестницы, вошли с захваченной мышью — сразу в игре', in2.ready && in2.started && in2.locked, JSON.stringify(in2));
    const dbg = await page.evaluate(() => ({ labels: [...document.querySelectorAll('.v3-loc-tools label')].map((l) => l.textContent), debug: !!document.querySelector('.v3-loc-debug') }));
    ok('2 в сцене нет отладки', !dbg.labels.some((t) => /отладка/.test(t)) && !dbg.debug, JSON.stringify(dbg));
    await sleep(800);
    ok('2 мышь захвачена — подсказки «Клик — захватить мышь» нет', !(await page.isVisible('.v3-loc-hint').catch(() => false)));
    await shot(page, '03-stair');
    // пауза: время сцены стоит
    const t0 = await page.evaluate(() => window.__rfStair.time);
    await releaseMouse(page);
    const t1 = await page.evaluate(() => window.__rfStair.time);
    await sleep(2000);
    const t2 = await page.evaluate(() => window.__rfStair.time);
    const sp = await st(page);
    ok('2 мышь отпущена — время сцены стоит', t2 === t1 && t1 >= t0 && sp.paused, JSON.stringify({ t0, t1, t2, paused: sp.paused }));
    ok('2 кнопка «Меню» в углу', sp.menuBtn && !sp.card, JSON.stringify(sp));
    await shot(page, '04-stair-paused');
    await page.keyboard.press('Escape');
    await sleep(400);
    const sm = await st(page);
    ok('2 Esc — меню паузы поверх сцены', sm.card && sm.cardTitle === 'Пауза', JSON.stringify(sm));
    await shot(page, '05-stair-menu');
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await sleep(300);
    ok('2 «Продолжить» — меню закрыто, сцену захватывает клик', !(await st(page)).card);
    ok('2 клик по сцене — мышь захвачена', await clickScene(page));
    await sleep(800);
    const t3 = await page.evaluate(() => window.__rfStair.time);
    ok('2 время сцены пошло', t3 > t2, `${t2} → ${t3}`);
    // Хвататель схватил — и сразу пауза: за 4 с не утащил
    await page.evaluate(() => {
      window.__rfStair.onEvent({ type: 'grabbed' });
      document.exitPointerLock();
    });
    await page.waitForFunction(() => !document.pointerLockElement && window.__rf3d.paused, null, { timeout: 5000 }).catch(() => {});
    await sleep(150);
    const g0 = await page.evaluate(() => window.__rfStair.grab?.t ?? null);
    await sleep(4000);
    const g1 = await page.evaluate(() => ({ t: window.__rfStair.grab?.t ?? null, dead: !!window.__rfStair.dead, fall: !!document.querySelector('.v3-story-fall, .v3-loc-dead') }));
    ok('2 Хвататель схватил, пауза 4 с — не утащил (рывок стоит)', g0 !== null && g1.t === g0 && !g1.dead && !g1.fall, JSON.stringify({ g0, g1 }));
    await shot(page, '06-stair-grab-paused');
    ok('2 клик по сцене — снова в игре', await clickScene(page));
    const fallTxt = await page.evaluate(async () => {
      for (let k = 0; k < 3000; k++) {
        const e = document.querySelector('.v3-story-fall') ?? document.querySelector('.v3-loc-dead');
        if (e) return e.className + ': ' + e.textContent;
        await new Promise((r) => setTimeout(r, 10));
      }
      return null;
    });
    ok('2 после паузы утащил — тьма и «Очнуться» (не «Ещё раз»)', !!fallTxt && /Очнуться/.test(fallTxt) && !/Ещё раз/.test(fallTxt), String(fallTxt));
    await shot(page, '07-stair-fall');
    await page.waitForFunction(() => !window.__rf3d.hasOverlay, null, { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    const wa = await where(page);
    ok('2 очнулся в общаге', wa.biome === 'obshaga' && !wa.overlay, JSON.stringify(wa));
    const sa = await st(page);
    ok('2 очнулся — пауза (мышь отпущена), «Общага» ещё не вспыхнула', sa.paused && sa.card && !(await flashes(page)).includes('Общага'), JSON.stringify({ sa, fl: await flashes(page) }));
    await shot(page, '08-obshaga-paused');
    ok('2 «Продолжить» в общаге', await resume(page));
    await page.waitForFunction(() => (window.__qaFlashes ?? []).includes('Общага'), null, { timeout: 8000 }).catch(() => {});
    ok('2 вспышка «Общага» — после паузы', (await flashes(page)).includes('Общага'), JSON.stringify(await flashes(page)));
    await sleep(400);
    await shot(page, '09-obshaga');
    obshOk = wa.biome === 'obshaga';
  }

  // ═════════════════ 3. общага: отключение света на паузе стоит ═════════════════
  if (obshOk) {
    const ob0 = await page.evaluate(() => {
      const q = window.__rfObshaga;
      q.calm(true);
      q.forceBlackout(false);
      const d = q.director();
      return d ? { phase: d.blackout.phase, t: d.blackout.t } : null;
    });
    await sleep(1200);
    const ob1 = await page.evaluate(() => {
      const d = window.__rfObshaga.director();
      return d ? { phase: d.blackout.phase, t: d.blackout.t } : null;
    });
    await releaseMouse(page);
    const ob2 = await page.evaluate(() => ({ ...window.__rfObshaga.director().blackout }));
    await sleep(2500);
    const ob3 = await page.evaluate(() => ({ ...window.__rfObshaga.director().blackout }));
    ok('3 общага: мигание идёт, на паузе время режиссёра стоит', !!ob0 && (ob1.t !== ob0.t || ob1.phase !== ob0.phase) && ob3.t === ob2.t && ob3.phase === ob2.phase, JSON.stringify({ ob0, ob1, ob2: [ob2.phase, ob2.t], ob3: [ob3.phase, ob3.t] }));
    await resume(page);
    await page.evaluate(() => {
      const q = window.__rfObshaga;
      q.lightsBack?.();
    });
  }

  // ═════════════════ 4. лестница → подвал: выход ногами вниз, мышь захвачена снова ═════════════════
  let lower = null;
  if (stair) {
    await goRoom(page, stair);
    await page.waitForFunction(() => window.__rfStair?.ready && window.__rfStair.started, null, { timeout: 120000 }).catch(() => {});
    if (!(await page.evaluate(() => !!document.pointerLockElement))) await clickScene(page);
    // как дошёл до низа разомкнутой лестницы и вышел в дверь: выход сцены (страница: операция мира descend)
    await page.evaluate(() => window.__rfStair.exit('descend'));
    await page.waitForFunction(() => !window.__rf3d.hasOverlay, null, { timeout: 20000 }).catch(() => {});
    await sleep(2500);
    const wb = await where(page);
    lower = wb.biome;
    ok('4 лестница вывела вниз — подвал (или катакомбы)', wb.biome === 'basement' || wb.biome === 'catacombs', JSON.stringify(wb));
    const sb = await st(page);
    ok('4 выход из сцены — мышь захвачена снова, без паузы', sb.locked && !sb.paused && !sb.card, JSON.stringify(sb));
    await page.waitForFunction(() => (window.__qaFlashes ?? []).includes('Подвал') || (window.__qaFlashes ?? []).includes('Питерские катакомбы'), null, { timeout: 8000 }).catch(() => {});
    ok('4 вспышка «Подвал»', (await flashes(page)).some((f) => f === 'Подвал' || f === 'Питерские катакомбы'), JSON.stringify(await flashes(page)));
    await shot(page, '10-basement');
  }

  // ═════════════════ 5. лифт: пауза; верхний этаж → сарай ═════════════════
  let barnOk = false;
  if (lower) {
    const lift = await growTransition(page, 'lift');
    ok('5 встал лифт', !!lift, String(lift));
    if (lift) {
      await goRoom(page, lift);
      await page.waitForFunction(() => window.__rfLift?.ready && window.__rfLift.started, null, { timeout: 120000 }).catch(() => {});
      const l0 = await page.evaluate(() => ({ ready: !!window.__rfLift?.ready, started: !!window.__rfLift?.started, labels: [...document.querySelectorAll('.v3-loc-tools label')].map((l) => l.textContent) }));
      ok('5 сцена лифта, без отладки', l0.ready && l0.started && !l0.labels.some((t) => /отладка/.test(t)), JSON.stringify(l0));
      await sleep(800);
      ok('5 мышь захвачена — подсказки «Клик — захватить мышь» нет', !(await page.isVisible('.v3-loc-hint').catch(() => false)));
      await shot(page, '11-lift');
      const lt0 = await page.evaluate(() => window.__rfLift.time);
      await releaseMouse(page);
      const lt1 = await page.evaluate(() => window.__rfLift.time);
      await sleep(2000);
      const lt2 = await page.evaluate(() => window.__rfLift.time);
      ok('5 лифт: мышь отпущена — время сцены стоит', lt2 === lt1 && lt1 >= lt0, JSON.stringify({ lt0, lt1, lt2 }));
      ok('5 клик по сцене — снова в игре', await clickScene(page));
      await sleep(600);
      ok('5 время сцены пошло', (await page.evaluate(() => window.__rfLift.time)) > lt2);
      // доехал до верхнего этажа и вышел прямо (выход сцены — как ногами)
      await page.evaluate(() => {
        const s = window.__rfLift;
        s.exit('straight', s.roll.floors, false);
      });
      await page.waitForFunction(() => !window.__rf3d.hasOverlay, null, { timeout: 20000 }).catch(() => {});
      await sleep(2500);
      const wc = await where(page);
      barnOk = wc.biome === 'barn';
      ok('5 лифт (верхний этаж) вывел в сарай', barnOk, JSON.stringify(wc));
      const sc = await st(page);
      ok('5 из лифта — мышь захвачена, без паузы', sc.locked && !sc.paused, JSON.stringify(sc));
      await page.waitForFunction(() => (window.__qaFlashes ?? []).includes('Бесконечный трухлявый сарай'), null, { timeout: 8000 }).catch(() => {});
      ok('5 вспышка «Бесконечный трухлявый сарай»', (await flashes(page)).includes('Бесконечный трухлявый сарай'), JSON.stringify((await flashes(page)).slice(-3)));
      await shot(page, '12-barn');
    }
  }

  // ═════════════════ 6. люк в погреб ═════════════════
  let cellarOk = false;
  if (barnOk) {
    const hatch = await growTransition(page, 'hatch');
    ok('6 в сарае встал «Люк в погреб»', !!hatch, String(hatch));
    if (hatch) {
      await goRoom(page, hatch);
      const g = await roomGeo(page, hatch);
      const yaw = (await page.evaluate((id) => window.__rfStory.info(id)?.yaw ?? 0, hatch)) || 0;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      // со стороны кольца (в комнате, не дальше 1.9 м), лицом к люку — подойти W
      const dh = Math.max(1.0, Math.min(1.9, (Math.abs(fx) > 0.5 ? g.hx : g.hz) - 0.4));
      await stand(page, g.cx + fx * dh, g.cz + fz * dh, g.cx, g.cz, 0.2);
      await frames(page, 3);
      const near = await walkUntilPrompt(page, /открыть люк/);
      const pr = await prompt(page);
      const dist = await page.evaluate(({ cx, cz }) => Math.hypot(window.__rf3d.fps.position.x - cx, window.__rf3d.fps.position.z - cz).toFixed(2), g);
      ok('6 подошёл (W) — «E — открыть люк»', near, `${pr} · до середины ${dist} м (старт ${dh.toFixed(2)})`);
      await shot(page, '13-hatch-prompt');
      if (near) {
        await page.keyboard.press('KeyE');
        await page.waitForFunction(() => /^hatch:/.test(window.__rfStory?.phase ?? ''), null, { timeout: 5000 }).catch(() => {});
        ok('6 E — крышка пошла', /^hatch:/.test((await phase(page)) ?? ''), String(await phase(page)));
        // пауза посреди сценария: фаза и время стоят
        await sleep(300);
        await releaseMouse(page);
        const h0 = await page.evaluate(() => [window.__rfStory.phase, window.__rfStory.t]);
        await sleep(1500);
        const h1 = await page.evaluate(() => [window.__rfStory.phase, window.__rfStory.t]);
        ok('6 пауза посреди сценария — стоит', h0[0] === h1[0] && h0[1] === h1[1], JSON.stringify([h0, h1]));
        await shot(page, '14-hatch-paused');
        await resume(page);
        await page.waitForFunction(() => window.__rfStory?.phase === null, null, { timeout: 30000 }).catch(() => {});
        await sleep(800);
        const wd = await where(page);
        cellarOk = wd.biome === 'cellar' && !wd.frozen;
        ok('6 спустился в погреб', cellarOk, JSON.stringify(wd));
        await page.waitForFunction(() => (window.__qaFlashes ?? []).includes('Погреб'), null, { timeout: 8000 }).catch(() => {});
        ok('6 вспышка «Погреб»', (await flashes(page)).includes('Погреб'), JSON.stringify((await flashes(page)).slice(-3)));
        await shot(page, '15-cellar');
      }
    }
  }

  // ═════════════════ 7. дверь в снег ═════════════════
  let snowOk = false;
  if (cellarOk) {
    const sd = await growTransition(page, 'snowdoor');
    ok('7 в погребе встала «Дверь в снег»', !!sd, String(sd));
    if (sd) {
      await goRoom(page, sd);
      const gs = await roomGeo(page, sd);
      const D = gs.door;
      ok('7 метка snowdoor на стене', !!D, JSON.stringify(D));
      if (D) {
        const dd = Math.max(1.0, Math.min(1.9, 2 * (Math.abs(D.ux) > 0.5 ? gs.hx : gs.hz) - 0.45));
        await stand(page, D.x + D.ux * dd, D.z + D.uz * dd, D.x, D.z, 0.05);
        await frames(page, 3);
        const near = await walkUntilPrompt(page, /открыть дверь/);
        const pr2 = await prompt(page);
        ok('7 подошёл (W) — «E — открыть дверь»', near && pr2 === 'E — открыть дверь', pr2);
        await shot(page, '16-snowdoor');
        if (near) {
          await page.keyboard.press('KeyE');
          await page.waitForFunction(() => window.__rfStory?.phase === 'snowdoor:crack', null, { timeout: 15000 }).catch(() => {});
          await sleep(600);
          await shot(page, '17-snowdoor-crack');
          await page.waitForFunction(() => window.__rfStory?.phase === 'snowdoor:buried', null, { timeout: 20000 }).catch(() => {});
          const pr3 = await prompt(page);
          ok('7 засыпало — «E — выкапываться»', /выкапываться/.test(pr3), pr3);
          await shot(page, '18-buried');
          const need = await page.evaluate((id) => window.__rfWalk.world.locationOf(id).roll.digs, sd);
          for (let k = 0; k < need; k++) {
            await page.keyboard.press('KeyE');
            await sleep(220);
          }
          await page.waitForFunction(() => window.__rfStory?.phase === null, null, { timeout: 30000 }).catch(() => {});
          await sleep(800);
          const ws = await where(page);
          snowOk = ws.biome === 'snow';
          ok(`7 E × ${need} — выбрался в снежных тоннелях (на четвереньках)`, snowOk && ws.pose === 'crawl' && !ws.frozen, JSON.stringify(ws));
          await page.waitForFunction(() => (window.__qaFlashes ?? []).includes('Снежные тоннели'), null, { timeout: 8000 }).catch(() => {});
          ok('7 вспышка «Снежные тоннели»', (await flashes(page)).includes('Снежные тоннели'), JSON.stringify((await flashes(page)).slice(-3)));
          await shot(page, '19-snow');
        }
      }
    }
  }

  // ═════════════════ 8. снег → завод → болото: «КОНЕЦ» ═════════════════
  if (snowOk) {
    const hangar = await growTransition(page, 'hangar');
    ok('8 в снегу встал ангар', !!hangar, String(hangar));
    let fac = null;
    if (hangar) {
      // провалился в ангар и вышел воротами: операция мира descend (как у страницы после сцены ангара)
      fac = await page.evaluate((id) => window.__rfWalk.request({ k: 'descend', id }), hangar);
      if (fac) await goRoom(page, fac);
      const wf = await where(page);
      ok('8 ворота ангара — завод', wf.biome === 'factory', JSON.stringify(wf));
      if (wf.biome !== 'factory') fac = null;
    }
    // болото — переход сюжета завода (trAfter = 2: встаёт через пару комнат); нет — «иди где влажнее»
    let swamp = fac ? await growTransition(page, 'swamp') : null;
    if (fac && !swamp) {
      // «иди где влажнее»: по самым мокрым соседям до болота
      const seen = new Set([fac]);
      let cur = fac;
      for (let step = 0; step < 160 && !swamp; step++) {
        const next = await page.evaluate(
          ({ cur, seen }) => {
            const w = window.__rfWalk.world;
            w.ensureAround?.(cur);
            const nb = [];
            for (const l of w.run().links) {
              if (l.kind === 'descent' || l.kind === 'lift' || l.sealed) continue;
              if (l.a.inst === cur) nb.push(l.b.inst);
              if (l.b.inst === cur) nb.push(l.a.inst);
            }
            const cand = nb.filter((x) => !seen.includes(x)).map((x) => ({ id: x, swamp: w.locationOf(x)?.kind === 'swamp', wet: w.wetAt(x) }));
            const val = (c) => (c.swamp ? 2 : c.wet ? c.wet.w : -1);
            cand.sort((a, b) => val(b) - val(a));
            return cand[0] ?? null;
          },
          { cur, seen: [...seen] },
        );
        if (!next) break;
        seen.add(next.id);
        cur = next.id;
        if (next.swamp) swamp = next.id;
        else {
          await page.evaluate((id) => window.__rf3dFold.goTo(id), cur);
          await sleep(150);
        }
      }
    }
    if (fac) ok('8 на заводе встало болото (финал)', !!swamp, String(swamp));
    if (swamp) {
      await page.evaluate((id) => window.__rf3dFold.goTo(id), swamp);
      await page.waitForFunction(() => !!window.__rfSwamp?.ready, null, { timeout: 300000 }).catch(() => {});
      await sleep(1500);
      const sw = await page.evaluate(() => ({ ready: !!window.__rfSwamp?.ready, place: window.__rfSwamp?.qaState().place, labels: [...document.querySelectorAll('.v3-loc-tools label')].map((l) => l.textContent) }));
      ok('8 сцена финала, без отладки', sw.ready && sw.place === 'hall' && !sw.labels.length, JSON.stringify(sw));
      await shot(page, '20-swamp');
      // пауза в зале: время стоит
      if (!(await page.evaluate(() => !!document.pointerLockElement))) await clickScene(page);
      await sleep(500);
      await releaseMouse(page);
      const sw0 = await page.evaluate(() => window.__rfSwamp.time);
      await sleep(1500);
      const sw1 = await page.evaluate(() => window.__rfSwamp.time);
      ok('8 болото: на паузе время стоит', sw0 === sw1, `${sw0} → ${sw1}`);
      await clickScene(page);
      // встать на зуб шестерни
      await page.evaluate(() => {
        const s = window.__rfSwamp, z = s.qaState().stepZone;
        s.place(z.x, z.z);
      });
      await page.waitForFunction(() => window.__rfSwamp.qaState().endT !== null, null, { timeout: 15000 }).catch(() => {});
      await sleep(2500);
      await shot(page, '21-swamp-press');
      await page.waitForSelector('.v3-end-btns button', { timeout: 240000 }).catch(() => {});
      await sleep(800);
      const end = await page.evaluate(() => ({ h1: document.querySelector('.v3-end h1')?.textContent, btns: [...document.querySelectorAll('.v3-end-btns button')].map((b) => b.textContent) }));
      ok('8 титры «КОНЕЦ», кнопки «Новая игра» / «Главное меню»', end.h1 === 'КОНЕЦ' && end.btns.join('|') === 'Новая игра|Главное меню', JSON.stringify(end));
      await shot(page, '22-end');
      await page.getByRole('button', { name: 'Главное меню', exact: true }).first().click();
      await page.waitForSelector('.play-board', { timeout: 30000 }).catch(() => {});
      ok('8 «Главное меню» → меню, сессии прогулки нет', (await page.isVisible('.play-board').catch(() => false)) && (await page.evaluate(() => !window.__rfWalk)));
      await shot(page, '23-menu');
    }
  }
} catch (e) {
  console.error(e);
  ok('скрипт без исключений', false, String(e?.message ?? e).slice(0, 400));
} finally {
  await browser.close();
  stopServer();
}
ok('ошибок в консоли нет', !errors.length, errors.slice(0, 6).join(' | '));
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length} FAIL из ${results.length}` : `\nвсе ${results.length} OK`);
process.exit(bad.length ? 1 : 0);
