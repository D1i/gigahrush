// QA спец-локации «Бесконечная лестница» (src/locations/sceneStairwell.ts) — playwright + системный Chrome.
// Свой dev-сервер (vite, порт 5212) поднимается в фоне и гасится в конце.
//
// Стенд без приложения (tools/qa-stairwell.html, ускоренная спецификация в адресе):
//  (а) спуск на 5 этажей пешком (контроллер, ступени) — на каждом сдвиге окна петли сравниваются кадры
//      до и после сдвига (та же развёрнутая точка, то же время) — пиксельно;
//  (б) звук → подъём на этаж → survived, K раз → opened: лестница конечна (без скачка и без тумана, свет по всей
//      шахте) → подъём до верхнего завершения (TopCap) → спуск к низу → дверь → выход 'descend';
//  (в) звук → шаг вниз → захват (ролик) → смерть → «ещё раз» (новая попытка у входа).
// Приложение (вкладка 3D):
//  (г) «Комната» → «Бесконечная лестница» → «Войти в локацию»: приглашение, смерть (экран, подсказка),
//      «Ещё раз», выход назад через входную дверь;
//  (д) «Прогулка»: найти в мире экземпляр лестницы, войти в него пешком через дверь, пережить звуки,
//      подняться до верха, спуститься к открытой двери — мир, комната-выход, «этаж −k» в HUD.
// Скриншоты — tools/qa/stair-*.png. node tools/qa-stairwell.mjs [--keep-server]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5212;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const keep = process.argv.includes('--keep-server');

// ── dev-сервер ──
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
/** Переход с повтором: свежий vite при первом запросе может пересобрать зависимости и оборвать загрузку. */
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

/** Автопилот в странице: ходьба по кольцу маршрута одного этажа (вниз/вверх) с реакцией на события механики. */
const PILOT = () => {
  const PATH = [[-0.78, 1.55], [-0.78, -2.1], [0.78, -2.1], [0.78, 1.55]];
  window.__pilot = {
    i: 0,
    dir: 1,
    seen: 0,
    /** идти, пока on(ev) не вернёт 'stop'; 'reverse' — развернуться. Возвращает журнал событий. */
    drive(s, on, maxSec = 240, run = true) {
      const evs = [];
      for (let k = 0; k < maxSec * 60; k++) {
        const [x, z] = PATH[this.i];
        const dx = x - s.pos.x, dz = z - s.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.08) {
          this.i = (this.i + this.dir + 4) % 4;
          continue;
        }
        s.camera.rotation.y = Math.atan2(dx, dz);
        s.camera.rotation.x = 0.3;
        s.simulate(1 / 60, { f: Math.min(1, d / 0.25), s: 0, run });
        s.applyWrap();
        for (; this.seen < s.log.length; this.seen++) {
          const e = s.log[this.seen].e;
          evs.push({ ...e, y: +s.log[this.seen].y.toFixed(2) });
          const r = on(e, s);
          if (r === 'reverse') {
            this.dir = -this.dir;
            this.i = (this.i + this.dir + 4) % 4;
          }
          if (r === 'stop') return evs;
        }
        if (s.qaState().exited) return evs;
      }
      evs.push({ type: 'timeout' });
      return evs;
    },
    /** по маршруту до площадки этажа f (вверх или вниз); false — упёрлись (верх/низ лестницы) */
    toFloor(s, f, run = true, maxSec = 300) {
      const dir = s.feetU > f * 3 ? 1 : -1;
      if (dir !== this.dir) {
        this.dir = dir;
        this.i = (this.i + dir + 4) % 4;
      }
      let last = [s.pos.x, s.pos.z, s.feetU], still = 0;
      for (let k = 0; k < maxSec * 60; k++) {
        if (Math.abs(s.feetU - f * 3) < 0.02 && s.pos.z > 1.3) return true;
        const [x, z] = PATH[this.i];
        const dx = x - s.pos.x, dz = z - s.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.08) {
          this.i = (this.i + this.dir + 4) % 4;
          continue;
        }
        s.camera.rotation.y = Math.atan2(dx, dz);
        s.camera.rotation.x = 0.3;
        s.simulate(1 / 60, { f: Math.min(1, d / 0.25), s: 0, run });
        s.applyWrap();
        const now = [s.pos.x, s.pos.z, s.feetU];
        if (Math.hypot(now[0] - last[0], now[1] - last[1], now[2] - last[2]) < 0.001) {
          if (++still > 90) return false;
        } else still = 0;
        last = now;
        if (s.qaState().exited) return false;
      }
      return false;
    },
  };
};

/** Доля чёрных пикселей кадра (все каналы < 8: туман/фон, а не тёмные материалы вроде поручня). */
const DARK_JS = `(px) => {
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] < 8 && px[i + 1] < 8 && px[i + 2] < 8) n++;
  return n / (px.length / 4);
}`;

const diffJS = `(a, b) => {
  let n = 0, mx = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (d > 0) n++;
    if (d > mx) mx = d;
  }
  return { n, mx, total: a.length / 4 };
}`;

try {
  // ═════════════════════ стенд ═════════════════════
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    watch(page, 'стенд');
    const open = async (q) => {
      // повтор: dev-сервер мог перезапуститься (оптимизация зависимостей) и оборвать загрузку GLB
      for (let k = 0; ; k++) {
        const e0 = errors.length;
        await go(page, BASE + 'tools/qa-stairwell.html?' + q);
        await page.waitForFunction(() => window.__stair && (window.__stair.ready || window.__stair.error), null, { timeout: 180000 });
        const err = await page.evaluate(() => window.__stair.error);
        if (!err) break;
        if (k >= 3) throw new Error(err);
        errors.splice(e0); // ошибки оборванной загрузки — не ошибки сцены
        await page.waitForTimeout(3000);
      }
      await page.evaluate(PILOT);
      await page.evaluate(() => window.__stair.qaStart());
    };
    const shot = async (n) => {
      await page.waitForTimeout(350);
      await page.screenshot({ path: out + `stair-${n}.png` });
    };

    // (а) петля бесшовна: 5 этажей вниз пешком, сравнение кадров на каждом сдвиге
    await open('seed=qa-a&interval=600,600');
    await shot('dark-1-entrance');
    const a = await page.evaluate(async (diffSrc) => {
      const diff = (0, eval)(diffSrc);
      const s = window.__stair, P = window.__pilot;
      s.noWrap = true;
      const checks = [];
      let maxJump = 0, last = s.feetU, steps = 0;
      const PATH = [[-0.78, 1.55], [-0.78, -2.1], [0.78, -2.1], [0.78, 1.55]];
      for (let f = 0; f < 5; f++)
        for (const [x, z] of PATH)
          for (let k = 0; k < 900; k++) {
            const dx = x - s.pos.x, dz = z - s.pos.z, d = Math.hypot(dx, dz);
            if (d < 0.06) break;
            s.camera.rotation.y = Math.atan2(dx, dz);
            s.camera.rotation.x = 0.35;
            s.simulate(1 / 60, { f: Math.min(1, d / 0.3), s: 0, run: false });
            steps++;
            maxJump = Math.max(maxJump, Math.abs(s.feetU - last));
            last = s.feetU;
            if (s.eyeY < 0 || s.eyeY >= 3) {
              const A = await s.pixels();
              const base0 = s.base;
              s.noWrap = false;
              s.applyWrap();
              s.noWrap = true;
              const B = await s.pixels();
              checks.push({ base: [base0, s.base], ...diff(A, B) });
            }
          }
      s.noWrap = false;
      return { checks, feetU: s.feetU, maxJump, steps, wraps: s.wraps };
    }, diffJS);
    const worst = a.checks.reduce((m, c) => Math.max(m, c.n / c.total), 0);
    const mx = a.checks.reduce((m, c) => Math.max(m, c.mx), 0);
    ok('(а) спуск на 5 этажей пешком по ступеням', Math.abs(a.feetU + 15) < 0.05, `y = ${a.feetU.toFixed(3)} м, шагов ${a.steps}, сдвигов окна ${a.wraps}`);
    ok('(а) развёрнутая высота непрерывна', a.maxJump < 0.2, `наибольший скачок за шаг ${a.maxJump.toFixed(3)} м (ступень 0.15)`);
    ok('(а) кадр до/после сдвига петли совпадает', a.checks.length === 5 && worst < 0.001 && mx <= 32,
      `${a.checks.length} сдвигов; отличается ≤ ${(worst * 100).toFixed(3)}% пикселей, макс. разница ${mx}/255 (округление float32 при сдвиге координат на 3 м): ` +
      a.checks.map((c) => `${c.n}px/${c.mx}`).join(', '));
    // темнота с фонариком: на марше вниз и вниз в пролёт
    await page.evaluate(() => {
      const s = window.__stair;
      s.walkTo(-0.78, 1.3);
      s.camera.rotation.set(0.45, Math.PI, 0);
      s.advance(0.3);
    });
    const darkLoop = await page.evaluate(async (darkSrc) => (0, eval)(darkSrc)(await window.__stair.pixels()), DARK_JS);
    await shot('dark-2-flight');
    await page.evaluate(() => {
      const s = window.__stair;
      s.walkTo(-0.78, -1.9);
      s.walkTo(0.1, -2.3);
      s.camera.rotation.set(0.3, 0.2, 0);
      s.advance(0.3);
    });
    await shot('dark-3-half-landing');

    // (б) звуки → подъём → survived ×K → opened → низ → выход вниз
    await open('seed=qa-b&interval=1,1.5&sounds=2,2&floors=2,2&grab=9&accel=6');
    const b = await page.evaluate(() => {
      const s = window.__stair, P = window.__pilot;
      const evs = P.drive(s, (e) => {
        if (e.type === 'sound') return 'reverse'; // вверх
        if (e.type === 'survived' && e.count < e.needed) return 'reverse'; // снова вниз
        if (e.type === 'opened') return 'stop';
      });
      return { evs, st: s.qaState() };
    });
    const sounds = b.evs.filter((e) => e.type === 'sound').length;
    const surv = b.evs.filter((e) => e.type === 'survived').length;
    ok('(б) звук → подъём на этаж → survived, K раз → opened', b.st.phase === 'open' && surv === 2 && sounds === 2,
      b.evs.filter((e) => e.type !== 'approach').map((e) => `${e.type}@${e.y}`).join(' '));
    // размыкание: в темноте первой вспышки — конечная лестница; координаты игрока не прыгают
    const op = await page.evaluate(() => {
      const s = window.__stair;
      s.vel.x = s.vel.z = 0; // стоим — любое смещение было бы скачком перестройки
      const a = { feet: s.feet, eye: s.eyeY, x: s.pos.x, z: s.pos.z, base: s.base };
      s.advance(0.1);
      const b = { feet: s.feet, eye: s.eyeY, x: s.pos.x, z: s.pos.z, base: s.base };
      s.advance(1.8);
      return { a, b, st: s.qaState() };
    });
    // глаза могут догонять ноги (сглаживание ступеней) — сравниваются ноги и место в плане
    const jump = Math.max(Math.abs(op.a.feet - op.b.feet), Math.hypot(op.a.x - op.b.x, op.a.z - op.b.z));
    ok('(б) размыкание без скачка: координаты и окно те же', op.a.base === op.b.base && jump < 0.05, `смещение ${jump.toFixed(4)} м, base ${op.a.base} → ${op.b.base}`);
    const fin = op.st;
    ok('(б) конечная лестница: низ — этаж ниже игрока, верх +2, все этажи модулями, без тумана',
      fin.bottom === Math.floor(fin.feetU / 3 + 1e-6) - 1 && fin.top === Math.floor(fin.feetU / 3 + 1e-6) + 2 && fin.floors === fin.top - fin.bottom + 1 && fin.fogEnd > 1000,
      `этажи ${fin.bottom}…${fin.top} (${fin.floors}), над ними TopCap, игрок y ${fin.feetU.toFixed(2)}, туман до ${fin.fogEnd} м`);
    const dark0 = await page.evaluate(async (darkSrc) => {
      const s = window.__stair;
      s.camera.rotation.set(0.4, Math.PI, 0);
      return (0, eval)(darkSrc)(await s.pixels());
    }, DARK_JS);
    await shot('open-1-lights');
    // вверх до верхнего завершения: выше не пускает
    const top = await page.evaluate(() => {
      const s = window.__stair, P = window.__pilot;
      const t = s.qaState().top;
      const reached = P.toFloor(s, t + 1, true);
      const y = s.feetU;
      const more = P.toFloor(s, t + 2, false, 20);
      return { t, reached, y, more, y2: s.feetU };
    });
    ok('(б) подъём до верха: площадка TopCap, выше лестницы нет', top.reached && Math.abs(top.y - (top.t + 1) * 3) < 0.02 && !top.more && top.y2 <= top.y + 0.01,
      `верх — площадка этажа ${top.t + 1} (y ${top.y.toFixed(2)}), попытка выше: y ${top.y2.toFixed(2)}`);
    const dTop = await page.evaluate(async (darkSrc) => {
      const s = window.__stair;
      s.walkTo(0, 1.45);
      s.camera.rotation.set(1.25, Math.PI, 0);
      s.advance(0.05);
      const down = (0, eval)(darkSrc)(await s.pixels());
      return down;
    }, DARK_JS);
    await shot('open-2-top-down-shaft');
    const dTop2 = await page.evaluate(async (darkSrc) => {
      const s = window.__stair;
      s.walkTo(-0.78, 1.5);
      s.camera.rotation.set(0.45, Math.PI, 0);
      s.advance(0.05);
      return (0, eval)(darkSrc)(await s.pixels());
    }, DARK_JS);
    await shot('open-3-top-down-flight');
    // спуск к низу: по маршруту до площадки нижнего этажа
    const down = await page.evaluate(() => {
      const s = window.__stair, P = window.__pilot;
      P.toFloor(s, s.qaState().bottom, true);
      s.walkTo(0.1, 1.9);
      s.camera.rotation.set(0.12, 0.05, 0);
      s.advance(1.2);
      return s.qaState();
    });
    ok('(б) дошли до низа: дверь нижнего этажа открыта', down.doors.some(([f, a]) => f === down.bottom && a > 1), `y ${down.feetU.toFixed(2)}, двери ${JSON.stringify(down.doors)}`);
    await shot('open-4-bottom-door');
    const dUp = await page.evaluate(async (darkSrc) => {
      const s = window.__stair;
      s.walkTo(0, 1.45);
      s.camera.rotation.set(-1.2, Math.PI, 0);
      s.advance(0.05);
      return (0, eval)(darkSrc)(await s.pixels());
    }, DARK_JS);
    await shot('open-5-bottom-up-shaft');
    const dark = { 'после вспышки': dark0, 'сверху в пролёт': dTop, 'сверху вниз по маршу': dTop2, 'снизу вверх в пролёт': dUp };
    ok('(б) без затемнения вдали: чёрных пикселей < 2% (в петле — темнота)', Object.values(dark).every((v) => v < 0.02) && darkLoop > 0.3,
      Object.entries(dark).map(([k, v]) => `${k} ${(v * 100).toFixed(2)}%`).join(', ') + `; для сравнения в петле ${(darkLoop * 100).toFixed(0)}%`);
    await page.evaluate(() => {
      const s = window.__stair;
      s.walkTo(0.1, 1.9);
      s.camera.rotation.set(0.5, Math.PI - 0.4, 0);
      s.advance(0.1);
    });
    await shot('open-6-bottom-slab');
    const ex = await page.evaluate(() => {
      const s = window.__stair;
      s.walkTo(0, 2.4);
      s.walkTo(0, 3.6);
      return { st: s.qaState(), exits: window.__stairExits.slice() };
    });
    ok('(б) проход в нижнюю дверь → выход вниз', ex.exits.includes('descend:2'), `выходы ${JSON.stringify(ex.exits)}`);

    // (в) звук → шаг вниз → захват → смерть → ещё раз
    await open('seed=qa-c&interval=1,1.5&sounds=3,3&grab=9&accel=6');
    const c = await page.evaluate(() => {
      const s = window.__stair, P = window.__pilot;
      let down = false;
      const evs = P.drive(s, (e) => {
        if (e.type === 'sound') down = true; // продолжаем вниз — ошибка игрока
        if (e.type === 'grabbed') return 'stop';
      });
      return { evs: evs.filter((e) => e.type !== 'approach'), st: s.qaState() };
    });
    ok('(в) звук → шаг вниз → захват', c.st.phase === 'grabbed' && c.evs.some((e) => e.type === 'grabbed' && e.reason === 'descended'), c.evs.map((e) => `${e.type}${e.reason ? ':' + e.reason : ''}@${e.y}`).join(' '));
    await page.evaluate(() => window.__stair.advance(0.25));
    await shot('grab-1-jerk');
    await page.evaluate(() => window.__stair.advance(0.6));
    await shot('grab-2-drag');
    await page.evaluate(() => window.__stair.advance(0.6));
    await shot('grab-3-fall');
    const dead = await page.evaluate(() => {
      const s = window.__stair;
      s.advance(1.5);
      const d = s.qaState();
      s.retry();
      s.manual = true;
      return { d, after: s.qaState(), hud: s.hud };
    });
    ok('(в) смерть после ролика', dead.d.dead?.reason === 'descended', JSON.stringify(dead.d.dead));
    ok('(в) «ещё раз» — новая попытка у входа', dead.after.phase === 'calm' && Math.abs(dead.after.feetU) < 1e-6 && dead.hud.attempt === 1 && dead.after.doors.some(([f]) => f === 0),
      `попытка ${dead.hud.attempt + 1}, y ${dead.after.feetU}`);
    // производительность шага физики+механики
    const perf = await page.evaluate(() => {
      const s = window.__stair, P = window.__pilot;
      const t = performance.now();
      P.drive(s, () => undefined, 10, false);
      return (performance.now() - t) / 600;
    });
    ok('шаг контроллера+механики (без рендера) дешёвый', perf < 0.5, `${perf.toFixed(3)} мс/шаг`);
    await page.close();
  }

  // ═════════════════════ приложение: «Комната» ═════════════════════
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    watch(page, 'комната');
    await go(page, BASE);
    await page.evaluate(() => localStorage.clear());
    await page.reload({ timeout: 180000 });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      window.__rfStairSpec = { interval: [1, 1.5], grabS: 9, accelS: 6 };
    });
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await page.waitForFunction(() => window.__rf3d, null, { timeout: 120000 });
    await page.getByRole('button', { name: 'Комната', exact: true }).click();
    await page.waitForTimeout(500);
    // выбрать «Бесконечная лестница»
    const sel = page.locator('aside.side select').first();
    await sel.selectOption({ value: 'stair_loop' });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Войти в локацию' }).click();
    await page.waitForFunction(() => window.__rfStair?.ready, null, { timeout: 180000 });
    await page.waitForTimeout(600);
    const prompt = await page.locator('.v3-loc-center.prompt').count();
    ok('(г) «Войти в локацию» — сцена и приглашение', prompt === 1);
    await page.screenshot({ path: out + 'stair-app-1-prompt.png' });
    await page.locator('.v3-loc-center.prompt').click();
    await page.waitForTimeout(500);
    await page.evaluate(PILOT);
    const started = await page.evaluate(() => {
      const s = window.__rfStair;
      s.qaStart();
      return s.hud.started;
    });
    ok('(г) клик — старт (звук запущен по жесту)', started && (await page.evaluate(() => window.__rfStair.audio.ctx?.state)) === 'running');
    // звук действительно идёт: уровень (RMS) на выходе — фон, «страшный звук» снизу, Хвататель рядом
    const level = (ms) => page.evaluate(async (ms) => {
      const a = window.__rfStair.audio;
      let mx = 0, sum = 0, n = 0;
      for (const t = performance.now(); performance.now() - t < ms; n++) {
        // сцена в ручном режиме (qaStart) — звук тикаем сами: дыхание и шаги Хвателя планируются в update
        a.update(0.04, { x: 0, y: 1.6, z: 2.15 }, { x: 0, y: 0, z: -1 });
        const v = a.level();
        mx = Math.max(mx, v);
        sum += v;
        await new Promise((r) => setTimeout(r, 40));
      }
      return { avg: sum / n, max: mx };
    }, ms);
    await page.waitForTimeout(1200);
    const amb = await level(2500);
    await page.evaluate(() => window.__rfStair.audio.scarySound());
    const scary = await level(3000);
    await page.evaluate(() => window.__rfStair.audio.approach(0.9));
    const near = await level(2500);
    await page.evaluate(() => window.__rfStair.audio.survived());
    await page.waitForTimeout(3800);
    // под нагрузкой SwiftShader аудиопоток может голодать — фон по пику окна, события — заметно громче фона
    ok('(г) WebAudio: фон слышен, «страшный звук» и близкий Хвататель — заметно громче', amb.max > 0.002 && scary.max > 2 * amb.max && near.max > 1.5 * amb.max,
      `RMS фон ${amb.avg.toFixed(3)} (пик ${amb.max.toFixed(3)}), звук — пик ${scary.max.toFixed(3)}, Хвататель (meter 0.9) ${near.avg.toFixed(3)} (пик ${near.max.toFixed(3)})`);
    // смерть: после звука — вниз
    await page.evaluate(() => {
      const s = window.__rfStair, P = window.__pilot;
      P.drive(s, (e) => (e.type === 'grabbed' ? 'stop' : undefined));
      s.advance(3);
    });
    await page.waitForSelector('.v3-loc-dead', { timeout: 10000 });
    const deadText = await page.locator('.v3-loc-dead').innerText();
    ok('(г) экран смерти и подсказка после первой смерти', /Хвататель утащил вас вглубь подъезда/.test(deadText) && /поднимитесь на этаж/.test(deadText), deadText.replace(/\s+/g, ' '));
    await page.screenshot({ path: out + 'stair-app-2-death.png' });
    await page.getByRole('button', { name: 'Ещё раз' }).click();
    await page.waitForTimeout(500);
    const again = await page.evaluate(() => {
      const s = window.__rfStair;
      s.manual = true;
      return { ...s.qaState(), attempt: s.hud.attempt };
    });
    ok('(г) «Ещё раз» — у входа, новая попытка', again.attempt === 1 && Math.abs(again.feetU) < 1e-6 && (await page.locator('.v3-loc-dead').count()) === 0);
    // выход назад через входную дверь
    await page.evaluate(() => {
      const s = window.__rfStair;
      s.advance(1.2); // дверь открывается
      s.walkTo(0, 2.4);
      s.walkTo(0, 3.6);
    });
    await page.waitForTimeout(600);
    const back = await page.evaluate(() => ({ stair: !!window.__rfStair, overlay: window.__rf3d.hasOverlay }));
    ok('(г) выход назад через входную дверь — снова комната', !back.stair && !back.overlay);
    await page.close();
  }

  // ═════════════════════ приложение: «Прогулка» ═════════════════════
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    watch(page, 'прогулка');
    const seed = 'qa-stair-walk';
    await go(page, BASE);
    await page.evaluate((seed) => {
      localStorage.clear();
      localStorage.setItem('room-forge/walk', JSON.stringify({ seed, deadEndChance: 0.1, branching: 1, aheadDoors: 2, on: true }));
    }, seed);
    await page.reload({ timeout: 180000 });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      window.__rfStairSpec = { interval: [1, 1.5], grabS: 9, accelS: 6 };
    });
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
    await page.waitForTimeout(1500);
    // найти экземпляр лестницы: раскрывать мир от старта (BFS), пока не встретится
    const found = await page.evaluate(() => {
      const w = window.__rfWalk.world;
      const seen = new Set();
      const queue = [w.startId];
      let loc = null;
      for (let k = 0; k < 900 && queue.length && !loc; k++) {
        const id = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        if (w.locationOf(id)) {
          loc = id;
          break;
        }
        w.expand(id);
        const run = w.run();
        for (const l of run.links) {
          if (l.kind === 'descent') continue;
          if (l.a.inst === id && !seen.has(l.b.inst)) queue.push(l.b.inst);
          if (l.b.inst === id && !seen.has(l.a.inst)) queue.push(l.a.inst);
        }
      }
      if (!loc) return null;
      const run = w.run();
      const l = run.links.find((x) => x.kind !== 'descent' && (x.a.inst === loc || x.b.inst === loc));
      return { loc, from: l ? (l.a.inst === loc ? l.b.inst : l.a.inst) : null, rooms: run.instances.length, L: w.locationOf(loc) };
    });
    ok('(д) в мире есть «Бесконечная лестница»', !!found?.from, found ? `${found.loc} (через ${found.from}), комнат ${found.rooms}, розыгрыш ${JSON.stringify(found.L?.roll)}` : 'не нашли');
    if (found?.from) {
      // в соседнюю комнату и пешком через дверь
      await page.waitForFunction((id) => window.__rfWalk.rx.instances.some((i) => i.id === id), found.loc, { timeout: 30000 });
      await page.evaluate((from) => window.__rf3dFold.goTo(from), found.from);
      await page.waitForTimeout(1500);
      const door = await page.evaluate(({ from, loc }) => {
        const d = window.__rf3dFold;
        const piece = d.pieces.get(from);
        const q = piece.portals.find((p) => p.to === loc);
        return q ? { axis: q.axis, at: q.at, dir: q.dir, lo: q.lo, hi: q.hi, floor: piece.floor } : null;
      }, found);
      ok('(д) дверь соседней комнаты в лестницу', !!door);
      if (door) {
        const mid = (door.lo + door.hi) / 2;
        const P = (n) => (door.axis === 'x' ? [door.at + door.dir * n, mid] : [mid, door.at + door.dir * n]);
        const walkIn = () => page.evaluate(async ({ pts }) => {
          const v = window.__rf3d;
          const cam = v.fps;
          const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
          // встать у проёма и идти сквозь него (коллизии и гравитация камеры болванки)
          cam.position.set(pts[0][0], 1.65, -pts[0][1]);
          cam.cameraDirection.setAll(0);
          for (let k = 0; k < 10; k++) await frame();
          for (const [x, y] of pts.slice(1)) {
            for (let k = 0; k < 240 && !v.hasOverlay; k++) {
              const dx = x - cam.position.x, dy = -y - cam.position.z, d = Math.hypot(dx, dy);
              if (d < 0.08) break;
              cam.cameraDirection.set((dx / d) * Math.min(0.05, d), 0, (dy / d) * Math.min(0.05, d));
              cam.rotation.y = Math.atan2(dx, dy);
              await frame();
            }
          }
          for (let k = 0; k < 600 && !window.__rfStair?.ready; k++) await frame();
          return { overlay: v.hasOverlay, ready: !!window.__rfStair?.ready };
        }, { pts: [P(-0.7), P(-0.2), P(0.5), P(1.0)] });
        let entered = await walkIn();
        ok('(д) шаг через порог в комнату-лестницу → сцена лестницы', entered.overlay && entered.ready);
        if (entered.ready) {
          // назад той же дверью: игрок — в комнате, откуда вошёл, у двери, лицом от неё
          await page.evaluate(() => {
            const s = window.__rfStair;
            s.qaStart();
            s.advance(0.6);
            s.walkTo(0, 2.4);
            s.walkTo(0, 3.6);
          });
          await page.waitForFunction(() => !window.__rf3d.hasOverlay, null, { timeout: 20000 }).catch(() => {});
          await page.waitForTimeout(800);
          const back = await page.evaluate(({ from }) => {
            const d = window.__rf3dFold, c = window.__rf3d.fps;
            return { overlay: window.__rf3d.hasOverlay, center: d.current.center, cur: d.portal.current, pos: [c.position.x, -c.position.z] };
          }, found);
          const dist = Math.hypot(back.pos[0] - P(-0.8)[0], back.pos[1] - P(-0.8)[1]);
          ok('(д) назад через входную дверь — в комнате, откуда вошёл, у двери', !back.overlay && back.center === found.from && back.cur === found.from && dist < 0.3,
            `комната ${back.center}, до точки у двери ${dist.toFixed(2)} м`);
          await page.screenshot({ path: out + 'stair-app-3-walk-back.png' });
          entered = await walkIn();
          ok('(д) снова внутрь — новая попытка', entered.ready && (await page.evaluate(() => window.__rfStair.state.attempt)) === 1);
        }
        if (entered.ready) {
          await page.evaluate(PILOT);
          const roll = await page.evaluate(() => window.__rfStair.roll);
          ok('(д) розыгрыш сцены — из мира (locationOf)', JSON.stringify(roll) === JSON.stringify(found.L.roll), JSON.stringify(roll));
          const flow = await page.evaluate(() => {
            const s = window.__rfStair, P = window.__pilot;
            s.qaStart();
            const evs = P.drive(s, (e) => {
              if (e.type === 'sound') return 'reverse';
              if (e.type === 'survived' && e.count < e.needed) return 'reverse';
              if (e.type === 'opened') return 'stop';
              if (e.type === 'grabbed') return 'stop';
            }, 600);
            s.advance(1.8);
            return { evs: evs.filter((e) => e.type !== 'approach').map((e) => `${e.type}@${e.y}`), st: s.qaState(), hud: s.hud };
          });
          ok('(д) лестница пережита и разомкнута', flow.st.phase === 'open', flow.evs.join(' '));
          await page.screenshot({ path: out + 'stair-app-4-walk-open.png' });
          const up = await page.evaluate(() => {
            const s = window.__rfStair, P = window.__pilot;
            const t = s.qaState().top;
            const ok = P.toFloor(s, t + 1, true);
            s.walkTo(0, 1.45);
            s.camera.rotation.set(1.2, Math.PI, 0);
            s.advance(0.05);
            return { ok, t, y: s.feetU };
          });
          ok('(д) подъём до верха разомкнутой лестницы', up.ok && Math.abs(up.y - (up.t + 1) * 3) < 0.02, `верх ${up.t + 1}, y ${up.y.toFixed(2)}`);
          await page.waitForTimeout(400);
          await page.screenshot({ path: out + 'stair-app-4b-walk-top.png' });
          await page.evaluate(() => {
            const s = window.__rfStair, P = window.__pilot;
            P.toFloor(s, s.qaState().bottom, true);
            s.advance(1.2);
            s.walkTo(0, 2.4);
            s.walkTo(0, 3.6);
          });
          await page.waitForFunction(() => !window.__rf3d.hasOverlay, null, { timeout: 20000 }).catch(() => {});
          await page.waitForTimeout(1500);
          const world = await page.evaluate((loc) => {
            const w = window.__rfWalk.world, d = window.__rf3dFold;
            const exit = w.exitOf(loc);
            const inst = w.run().instances.find((i) => i.id === exit);
            return { exit, center: d.current.center, floor: inst?.floor ?? null, hud: document.querySelector('.v3-walkhud')?.textContent ?? '' };
          }, found.loc);
          ok('(д) выход вниз → мир, комната-выход', !!world.exit && world.center === world.exit, `выход ${world.exit}, текущая ${world.center}`);
          const k = found.L.roll.floorsDown;
          ok(`(д) этаж −${k} в HUD`, world.floor === -k && world.hud.includes(`этаж −${k}`), `этаж ${world.floor}, HUD «${world.hud}»`);
          await page.screenshot({ path: out + 'stair-app-5-walk-below.png' });
        }
      }
    }
    await page.close();
  }
} catch (e) {
  console.error(e);
  ok('сценарий без исключений', false, String(e?.message ?? e));
} finally {
  await browser.close();
  stopServer();
}

const bad = results.filter((r) => !r.ok);
if (errors.length) console.log('\nОшибки страницы:\n' + [...new Set(errors)].slice(0, 30).join('\n'));
console.log(`\nИтого: ${results.length - bad.length}/${results.length} проверок OK${errors.length ? `, ошибок страницы: ${errors.length}` : ''}`);
process.exit(bad.length || errors.length ? 1 : 0);
