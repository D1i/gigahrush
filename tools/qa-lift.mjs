// QA спец-локации «Ржавый лифт» (src/locations/sceneLift.ts) — playwright + системный Chrome.
// Свой dev-сервер (vite, порт 5214) поднимается в фоне и гасится в конце.
//
// Вкладка 3D → «Комната» → «Ржавый лифт А — клетка» / «Б — каретка» → «Войти в локацию» (доска на каждом пролёте —
// window.__rfLiftSpec):
//  (а) клетка: вход по узкому коридору этажа 0, в кабину, кнопка «вверх» → доска (пыль, крен), бот гасит раскачку,
//      перебегая на поднявшуюся сторону → кабина едет дальше → этаж 1, оба проёма открыты; этаж логова — дверь
//      логова в конце коридора, подсказка «E — открыть»; выход через конец коридора → onExit;
//  (б) каретка: доска → игрок стоит → выброс в шахту → экран смерти, подсказка → «Ещё раз» (новая попытка у входа);
//  (б2) клетка: доска → игрок стоит → трос трещит дважды и рвётся → клетка с игроком падает → «Трос оборвался»
//      → «Ещё раз»;
//  (в) ошибки консоли, число активных мешей, кадр.
// Скриншоты — tools/qa/lift-*.png. node tools/qa-lift.mjs [--keep-server]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5214;
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
if (!/ready in|Local:/.test(serverLog)) {
  console.error('vite не поднялся:\n' + serverLog);
  stopServer();
  process.exit(1);
}
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
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`[${tag}] PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock/i.test(m.text()) && errors.push(`[${tag}] ${m.text().slice(0, 300)}`));
};

/** Автопилот в странице: дойти до точки; гасить раскачку (на поднявшуюся сторону на долю площадки). */
const PILOT = () => {
  window.__lp = {
    /** идти к (x, z) мира сцены; true — дошёл */
    walk(s, x, z, maxSec = 8, run = false) {
      for (let k = 0; k < maxSec * 60; k++) {
        const dx = x - s.pos.x, dz = z - s.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.08) return true;
        s.camera.rotation.y = Math.atan2(dx, dz);
        s.simulate(1 / 60, { f: Math.min(1, d / 0.2), s: 0, run });
        s.sync();
        if (s.state.phase === 'thrown' || s.hud().dead) return false;
      }
      return false;
    },
    /** в раскачке — на поднявшуюся сторону (frac — доля полуразмера), до steady; журнал событий */
    balance(s, frac = 0.5, maxSec = 40, react = 0.25) {
      const evs = [];
      const hist = [];
      let seen = s.log.length;
      for (let k = 0; k < maxSec * 60; k++) {
        const sw = s.state.swing;
        let f = 0;
        if (sw) {
          hist.push(sw.phi);
          const phi = hist[Math.max(0, hist.length - 1 - Math.round(react * 60))];
          // в осях механики цель p = −sgn φ · frac; в мире сцены: x = −p·1.0 (ось x), z = p·1.5 (ось z)
          const p = -Math.sign(phi) * frac;
          const tx = sw.axis === 'x' ? -p * 1.0 : s.pos.x * 0.9;
          const tz = sw.axis === 'z' ? p * 1.5 : s.pos.z * 0.9;
          const dx = tx - s.pos.x, dz = tz - s.pos.z, d = Math.hypot(dx, dz);
          if (d > 0.05) s.camera.rotation.y = Math.atan2(dx, dz);
          f = d > 0.05 ? Math.min(1, d / 0.15) : 0;
        }
        s.simulate(1 / 60, { f, s: 0, run: true });
        s.sync();
        for (; seen < s.log.length; seen++) evs.push(s.log[seen].e.type);
        if (evs.includes('steady') || evs.includes('thrown') || evs.includes('arrive')) break;
      }
      return evs;
    },
  };
};

async function openLift(page, spec, id = 'lift_rusty') {
  await page.evaluate((sp) => {
    window.__rfLiftSpec = sp;
  }, spec);
  await page.getByRole('button', { name: 'Комната', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('aside.side select').first().selectOption({ value: id });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Войти в локацию' }).click();
  await page.waitForFunction(() => window.__rfLift?.ready, null, { timeout: 180000 });
  await page.waitForTimeout(500);
}

const shot = async (page, name) => {
  await page.waitForTimeout(150);
  await page.screenshot({ path: out + name });
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page, 'лифт');
  await go(page, BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ timeout: 180000 });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rf3d, null, { timeout: 120000 });

  // ═════════ (а) клетка ═════════
  await openLift(page, { boardChance: 1, lairChance: 1, floorsUp: [3, 3] }, 'lift_rusty');
  ok('(а) «Войти в локацию» — сцена и приглашение', (await page.locator('.v3-loc-center.prompt').count()) === 1);
  await shot(page, 'lift-1-prompt.png');
  await page.locator('.v3-loc-center.prompt').click();
  await page.waitForTimeout(300);
  await page.evaluate(PILOT);
  await page.evaluate(() => window.__rfLift.qaStart());
  const st0 = await page.evaluate(() => window.__rfLift.qaState());
  ok('(а) старт в узком коридоре этажа 0, кабина стоит', st0.phase === 'idle' && st0.floor === 0 && !st0.inCage && st0.pos.z > 4, JSON.stringify(st0.pos) + ' ' + st0.variant);
  await page.evaluate(() => window.__rfLift.place(0, 5.3, Math.PI, 0.05));
  await shot(page, 'lift-2-entry-corridor.png');
  const inCage = await page.evaluate(() => window.__lp.walk(window.__rfLift, 0, 0.2, 10));
  const st1 = await page.evaluate(() => window.__rfLift.qaState());
  ok('(а) дошёл по коридору в кабину', inCage && st1.inCage, JSON.stringify(st1.pos));
  await page.evaluate(() => window.__rfLift.place(0.3, -0.8, 0.2, 0.05));
  await shot(page, 'lift-3-in-cage-front.png');
  // боковой выход этажа 0 заколочен: смотреть направо (−x мира сцены)
  await page.evaluate(() => window.__rfLift.place(0.2, 0, -Math.PI / 2, 0.05));
  await shot(page, 'lift-4-floor0-boarded-right.png');
  // вверх: доска на первом пролёте
  await page.evaluate(() => window.__rfLift.place(0, 0, Math.PI / 2, -0.1));
  const ride = await page.evaluate(() => {
    const s = window.__rfLift;
    const ev = [];
    let seen = s.log.length;
    s.press('up');
    for (let k = 0; k < 60 * 20; k++) {
      s.simulate(1 / 60, { f: 0, s: 0, run: false });
      s.sync();
      for (; seen < s.log.length; seen++) ev.push(s.log[seen].e.type);
      if (ev.includes('board')) break;
    }
    return { ev, st: s.qaState() };
  });
  ok('(а) кнопка «вверх» → поехал → доска застряла', ride.ev[0] === 'depart' && ride.ev.includes('board') && ride.st.phase === 'jammed', ride.ev.join(','));
  await page.evaluate(() => window.__rfLift.advance(0.15));
  await shot(page, 'lift-5-board-dust.png');
  // посмотреть на доску: в сторону её зазора
  const side = await page.evaluate(() => window.__rfLift.log.findLast((l) => l.e.type === 'board').e.side);
  await page.evaluate((sd) => window.__rfLift.place(0, 0, sd === 'right' ? -Math.PI / 2 : 0, -0.25), side);
  await page.evaluate(() => window.__rfLift.advance(0.6));
  await shot(page, 'lift-6-board-wedged.png');
  // раскачка: бот гасит на поднявшуюся сторону
  await page.evaluate(() => window.__rfLift.advance(0.8));
  await shot(page, 'lift-7-sway-tilt.png');
  const bal = await page.evaluate(() => window.__lp.balance(window.__rfLift, 0.5, 40, 0.25));
  const st2 = await page.evaluate(() => window.__rfLift.qaState());
  ok('(а) клетку не выбросило, раскачка стихла — едет дальше', bal.includes('steady') && !bal.includes('thrown'), bal.filter((e) => e !== 'sway').join(','));
  const arr = await page.evaluate(() => {
    const s = window.__rfLift;
    for (let k = 0; k < 60 * 20 && s.state.phase !== 'idle'; k++) {
      s.simulate(1 / 60, { f: 0, s: 0, run: false });
      s.sync();
    }
    return s.qaState();
  });
  ok('(а) доехал до этажа 1, выходы прямо и направо', arr.phase === 'idle' && arr.floor === 1, JSON.stringify({ floor: arr.floor, y: arr.y }));
  await page.evaluate(() => window.__rfLift.place(0, 0, 0, 0.02));
  await shot(page, 'lift-8-floor1-straight.png');
  await page.evaluate(() => window.__rfLift.place(0, 0, -Math.PI / 2, 0.02));
  await shot(page, 'lift-9-floor1-right.png');
  // логово: доехать до его этажа и выйти в его коридор
  const lair = st2.lair;
  if (lair) {
    const toLair = await page.evaluate((L) => {
      const s = window.__rfLift;
      for (let g = 0; g < 8 && s.state.floor !== L.floor; g++) {
        s.press(s.state.floor < L.floor ? 'up' : 'down');
        for (let k = 0; k < 60 * 30 && s.state.phase !== 'idle'; k++) {
          if (s.state.phase === 'jammed') window.__lp.balance(s, 0.5, 40, 0.25);
          s.simulate(1 / 60, { f: 0, s: 0, run: false });
          s.sync();
        }
      }
      return s.qaState();
    }, lair);
    ok('(а) доехал до этажа логова', toLair.floor === lair.floor && toLair.phase === 'idle', `этаж ${toLair.floor}, ${lair.side}`);
    const door = lair.side === 'right' ? [-5.5, 0, -Math.PI / 2] : [0, 5.0, 0];
    const reached = await page.evaluate((d) => window.__lp.walk(window.__rfLift, d[0], d[1], 12), door);
    await page.evaluate((d) => window.__rfLift.place(d[0], d[1], d[2], 0.05), door);
    const hud = await page.evaluate(() => window.__rfLift.hud());
    ok('(а) коридор логова: дверь, подсказка «E — открыть»', reached && hud.prompt === 'E — открыть дверь', hud.prompt ?? '—');
    await page.evaluate((d) => window.__rfLift.place(d[0] * 0.55, d[1] * 0.55, d[2], 0.05), door);
    await shot(page, 'lift-10-lair-corridor.png');
    // назад в кабину
    await page.evaluate(() => window.__lp.walk(window.__rfLift, 0, 0, 12));
  }
  // выход: в конец узкого коридора этажа, где стоит кабина (если там логово — широкий)
  const exitDir = await page.evaluate(() => {
    const s = window.__rfLift;
    const L = s.roll.lair;
    return L && L.floor === s.state.floor && L.side === 'straight' ? 'right' : 'straight';
  });
  await page.evaluate(() => {
    window.__exitEv = null;
  });
  const walked = await page.evaluate((dir) => (dir === 'straight' ? window.__lp.walk(window.__rfLift, 0, 6.0, 12) : window.__lp.walk(window.__rfLift, -6.4, 0, 12)), exitDir);
  await page.waitForTimeout(500);
  const closed = await page.evaluate(() => ({ lift: !!window.__rfLift, overlay: window.__rf3d.hasOverlay }));
  const toast = await page.locator('.toast, .toasts').allInnerTexts().catch(() => []);
  ok('(а) выход через конец коридора — сцена закрыта, сообщение', !closed.lift && !closed.overlay, (walked ? '' : 'не дошёл; ') + toast.join(' | ').slice(0, 160));

  // ═════════ (а2) настройки по умолчанию (без подмен): первый подъём — с доской; этажи ниже входа ═════════
  await openLift(page, {}, 'lift_rusty');
  await page.locator('.v3-loc-center.prompt').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__rfLift.qaStart());
  const def = await page.evaluate(() => {
    const s = window.__rfLift;
    window.__lp.walk(s, 0, 0, 10);
    const ev = [];
    let seen = s.log.length;
    s.press('up');
    for (let k = 0; k < 60 * 30 && !ev.includes('board'); k++) {
      s.simulate(1 / 60, { f: 0, s: 0, run: false });
      s.sync();
      for (; seen < s.log.length; seen++) ev.push(s.log[seen].e.type);
    }
    return { ev, st: s.qaState(), down: s.roll.down };
  });
  ok('(а2) по умолчанию первый подъём — доска', def.ev.includes('board'), def.ev.join(','));
  ok('(а2) у лифта есть этажи ниже входа', def.down >= 1, `вниз ${def.down}, вверх ${def.st.floors}`);
  // погасить, вернуться вниз на самый нижний этаж
  const low = await page.evaluate(() => {
    const s = window.__rfLift;
    window.__lp.balance(s, 0.5, 40, 0.25);
    for (let g = 0; g < 12 && s.state.floor !== -s.roll.down; g++) {
      if (s.state.phase !== 'idle' && s.state.phase !== 'moving') {
        window.__lp.balance(s, 0.5, 40, 0.25);
        continue;
      }
      s.press('down');
      for (let k = 0; k < 60 * 30 && s.state.phase === 'moving'; k++) {
        s.simulate(1 / 60, { f: 0, s: 0, run: false });
        s.sync();
      }
    }
    return s.qaState();
  });
  ok('(а2) спуск ниже входа — кабина у нижнего этажа, выходы открыты', low.phase === 'idle' && low.floor < 0 && low.y < 0, JSON.stringify({ floor: low.floor, y: low.y }));
  await page.evaluate(() => window.__rfLift.place(0, 0, -Math.PI / 2, 0.05));
  await page.waitForTimeout(150);
  const prompt = await page.evaluate(() => window.__rfLift.hud().prompt);
  ok('(а2) кнопки внизу: «вверх» с подписью этажа, «вниз» нет', /E — вверх \(−?\d\)/.test(prompt ?? '') && !/Q — вниз/.test(prompt ?? ''), prompt ?? '—');
  await page.screenshot({ path: out + 'lift-14-basement-right.png' });
  await page.evaluate(() => window.__rfLift.place(0.3, -0.9, Math.PI + 0.25, -0.05));
  await page.screenshot({ path: out + 'lift-15-basement-number.png' });
  await page.evaluate(() => [...document.querySelectorAll('.v3-loc-tools button')].find((b) => b.textContent.trim() === 'выйти')?.click());
  await page.waitForTimeout(400);

  // ═════════ (б) каретка: стоять — выбросит ═════════
  await openLift(page, { boardChance: 1, floorsUp: [3, 3] }, 'lift_carriage');
  await page.locator('.v3-loc-center.prompt').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__rfLift.qaStart());
  const v = await page.evaluate(() => window.__rfLift.qaState().variant);
  ok('(б) каретка', v === 'carriage');
  await page.evaluate(() => window.__lp.walk(window.__rfLift, 0, 0.2, 10));
  await page.evaluate(() => window.__rfLift.place(0.2, 0.4, Math.PI * 0.75, 0.0));
  await shot(page, 'lift-11-carriage.png');
  await page.evaluate(() => window.__rfLift.press('up'));
  const thrown = await page.evaluate(() => {
    const s = window.__rfLift;
    const ev = [];
    let seen = s.log.length;
    let shotAt = null;
    for (let k = 0; k < 60 * 40; k++) {
      s.simulate(1 / 60, { f: 0, s: 0, run: false });
      s.sync();
      for (; seen < s.log.length; seen++) ev.push(s.log[seen].e.type);
      if (s.state.swing && Math.abs(s.state.swing.phi) > 0.75 && shotAt === null) shotAt = k;
      if (shotAt !== null && k === shotAt) break;
    }
    return { ev, phi: s.state.swing?.phi ?? null };
  });
  await shot(page, 'lift-12-carriage-tilt.png');
  const fallen = await page.evaluate(() => {
    const s = window.__rfLift;
    const ev = [];
    let seen = s.log.length;
    for (let k = 0; k < 60 * 30 && !s.hud().dead; k++) {
      s.simulate(1 / 60, { f: 0, s: 0, run: false });
      s.sync();
      for (; seen < s.log.length; seen++) ev.push(s.log[seen].e.type);
      if (ev.includes('thrown') && k % 30 === 0 && !window.__fallShot) window.__fallShot = k;
    }
    return { ev, dead: s.hud().dead };
  });
  ok('(б) каретка: стоял на месте → выброс', fallen.ev.includes('thrown') && fallen.dead?.reason === 'thrown', `крен ${thrown.phi?.toFixed(2)}; ${[...thrown.ev, ...fallen.ev].filter((e) => e !== 'sway').join(',')}`);
  await page.waitForTimeout(300);
  const deadText = await page.locator('.v3-loc-dead').innerText().catch(() => '');
  ok('(б) экран смерти с подсказкой', /выбросило/.test(deadText) && /поднявшуюся/.test(deadText), deadText.replace(/\s+/g, ' '));
  await shot(page, 'lift-13-dead.png');
  const before = await page.evaluate(() => window.__rfLift.qaState().attempt);
  await page.evaluate(() => document.querySelector('.v3-loc-dead button').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__rfLift.qaStart());
  const again = await page.evaluate(() => window.__rfLift.qaState());
  const deadLeft = await page.locator('.v3-loc-dead').count();
  ok('(б) «Ещё раз» — новая попытка у входа', again.attempt === before + 1 && again.floor === 0 && again.phase === 'idle' && deadLeft === 0, JSON.stringify({ a: again.attempt, f: again.floor, p: again.phase, dead: deadLeft }));
  // ═════════ (б2) клетка: стоять — трос рвётся ═════════
  await page.evaluate(() => [...document.querySelectorAll('.v3-loc-tools button')].find((b) => b.textContent.trim() === 'выйти')?.click());
  await page.waitForTimeout(400);
  await openLift(page, { boardChance: 1, floorsUp: [3, 3] }, 'lift_rusty');
  await page.locator('.v3-loc-center.prompt').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__rfLift.qaStart());
  ok('(б2) клетка', (await page.evaluate(() => window.__rfLift.qaState().variant)) === 'cage');
  await page.evaluate(() => window.__lp.walk(window.__rfLift, 0, 0.2, 10));
  await page.evaluate(() => window.__rfLift.place(0, 0, Math.PI * 0.75, 0.0));
  await page.evaluate(() => window.__rfLift.press('up'));
  // стоять до обрыва; кадр — в полёте
  const snap = await page.evaluate(() => {
    const s = window.__rfLift;
    const ev = [];
    let seen = s.log.length;
    let y0 = null;
    for (let k = 0; k < 60 * 60 && !ev.includes('snap'); k++) {
      s.simulate(1 / 60, { f: 0, s: 0, run: false });
      s.sync();
      for (; seen < s.log.length; seen++) ev.push(s.log[seen].e.type);
    }
    // высота кабины и игрока (стойка) в момент обрыва и через 40 кадров
    y0 = [s.cage.position.y, s.rig.position.y];
    for (let k = 0; k < 40; k++) {
      s.simulate(1 / 60, { f: 0, s: 0, run: false });
      s.sync();
    }
    return { ev, wear: s.state.wear, fell: y0[0] - s.cage.position.y, fellP: y0[1] - s.rig.position.y };
  });
  await shot(page, 'lift-14-cage-snap-fall.png');
  const cageDead = await page.evaluate(() => {
    const s = window.__rfLift;
    for (let k = 0; k < 60 * 10 && !s.hud().dead; k++) {
      s.simulate(1 / 60, { f: 0, s: 0, run: false });
      s.sync();
    }
    return s.hud().dead;
  });
  ok(
    '(б2) клетка: стоял на месте → трос трещит дважды, рвётся, клетка с игроком падает',
    snap.ev.filter((e) => e === 'fray').length === 2 && snap.ev.at(-1) === 'snap' && !snap.ev.includes('thrown') && snap.fell > 1 && Math.abs(snap.fellP - snap.fell) < 0.3 && cageDead?.reason === 'snap',
    JSON.stringify({ ev: snap.ev.filter((e) => e !== 'sway').join(','), wear: +snap.wear.toFixed(2), fell: +snap.fell.toFixed(2), fellP: +snap.fellP.toFixed(2), dead: cageDead }),
  );
  await page.waitForTimeout(300);
  const cageText = await page.locator('.v3-loc-dead').innerText().catch(() => '');
  ok('(б2) экран смерти — «Трос оборвался»', /Трос оборвался/.test(cageText), cageText.replace(/\s+/g, ' '));
  await shot(page, 'lift-15-cage-dead.png');
  const cb = await page.evaluate(() => window.__rfLift.qaState().attempt);
  await page.evaluate(() => document.querySelector('.v3-loc-dead button').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__rfLift.qaStart());
  const cAgain = await page.evaluate(() => window.__rfLift.qaState());
  ok('(б2) «Ещё раз» — новая попытка, трос целый', cAgain.attempt === cb + 1 && cAgain.phase === 'idle' && cAgain.floor === 0, JSON.stringify({ a: cAgain.attempt, p: cAgain.phase }));
  // перф: кадр в покое
  const perf = await page.evaluate(async () => {
    const s = window.__rfLift;
    s.manual = false;
    const t0 = performance.now();
    let n = 0;
    await new Promise((res) => {
      const f = () => {
        n++;
        if (performance.now() - t0 > 2000) res();
        else requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    return { fps: (n / ((performance.now() - t0) / 1000)).toFixed(1), meshes: s.scene.meshes.length, active: s.scene.getActiveMeshes().length };
  });
  ok('(в) кадр (swiftshader) и меши', true, JSON.stringify(perf));
  await page.evaluate(() => [...document.querySelectorAll('.v3-loc-tools button')].find((b) => b.textContent.trim() === 'выйти')?.click());
  await page.waitForTimeout(300);
} catch (e) {
  console.error(e);
  ok('скрипт не упал', false, String(e?.message ?? e));
}

ok('(в) нет ошибок в консоли', errors.length === 0, errors.slice(0, 6).join(' || '));
await browser.close();
stopServer();
const bad = results.filter((r) => !r.ok);
console.log(`\nИтого: ${results.length - bad.length}/${results.length}`);
process.exit(bad.length ? 1 : 0);
