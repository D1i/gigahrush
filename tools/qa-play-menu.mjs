// QA «Запустить без отладки» (src/play/PlayPage.tsx, docs/GAMEPLAY.md «Запуск без отладки»): playwright + системный
// Chrome, свой vite (порт 5291).
//  1. Шапка → «▶ Запустить без отладки»: шапки нет, меню (наборная доска) видно.
//  2. «Одиночная игра» → «Новая игра» (если есть сохранение — «Да, новая игра»): прогулка мира сюжета (story), холст на
//     весь экран, отладки нет (aside.side, .v3-tools, .v3-perf), отладочные настройки прогулки (room-forge/walk) не тронуты.
//  3. Мышь не захвачена — экран входа / пауза; «Главное меню» → меню; «Мультиплеер» → форма лобби; «Назад».
//  4. «Мультиплеер» → «Создать лобби» → «Играть»: мир лобби — сюжет, пауза с кодом; «Выйти из лобби в меню»;
//     «Выйти в редактор» → шапка.
// Скриншоты — tmp/play-*.png. node tools/qa-play-menu.mjs [--keep-server] [--config tmp/<vite-конфиг>.ts]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5291;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('../tmp/', import.meta.url));
mkdirSync(out, { recursive: true });
const keep = process.argv.includes('--keep-server');
const ci = process.argv.indexOf('--config');
const cfg = ci > 0 ? ` --config ${process.argv[ci + 1]}` : '';
const server = spawn(`npx vite --port ${PORT} --strictPort${cfg}`, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
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

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|ERR_CONNECTION_REFUSED|steam/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
  for (let k = 0; ; k++) {
    try {
      await page.goto(BASE, { timeout: 180000 });
      break;
    } catch (e) {
      if (k >= 4) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  const walkBefore = await page.evaluate(() => localStorage.getItem('room-forge/walk'));

  // 1. меню
  await page.getByRole('button', { name: '▶ Запустить без отладки' }).click();
  await page.waitForSelector('.play-board', { timeout: 60000 });
  ok('меню: доска видна', await page.isVisible('.play-board'));
  ok('меню: шапки нет', !(await page.$('.topbar')));
  ok('меню: заголовок', /гигахрущ/i.test((await page.textContent('.play-title')) ?? ''));
  await page.waitForTimeout(400);
  await page.screenshot({ path: out + 'play-menu.png' });

  // 2. одиночная → новая игра
  await page.getByRole('menuitem', { name: 'Одиночная игра' }).click();
  await page.waitForSelector('.play-board-head');
  await page.screenshot({ path: out + 'play-solo.png' });
  await page.getByRole('menuitem', { name: 'Новая игра' }).click();
  const confirm = page.getByRole('menuitem', { name: 'Да, новая игра' });
  if (await confirm.isVisible().catch(() => false)) {
    ok('новая игра: при сохранении — вопрос «Начать заново?»', true);
    await confirm.click();
  }
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => ({
    story: window.__rfWalk.opts.story === true,
    seed: window.__rfWalk.opts.seed,
    saved: localStorage.getItem('room-forge/story'),
    canvas: (() => {
      const c = document.querySelector('.v3-play canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height)];
    })(),
  }));
  ok('игра: мир сюжета (opts.story)', st.story, `сид ${st.seed}`);
  ok('игра: сид сохранён в room-forge/story', !!st.saved && st.saved.includes(st.seed), st.saved ?? '');
  ok('игра: холст на весь экран', !!st.canvas && st.canvas[0] === 1440 && st.canvas[1] === 860, JSON.stringify(st.canvas));
  ok('игра: нет aside.side', !(await page.$('aside.side')));
  ok('игра: нет .v3-tools', !(await page.$('.v3-tools')));
  ok('игра: нет .v3-perf', !(await page.$('.v3-perf')));
  ok('игра: нет .v3-here', !(await page.$('.v3-here')));
  ok('игра: настройки отладочной прогулки не тронуты', (await page.evaluate(() => localStorage.getItem('room-forge/walk'))) === walkBefore);
  ok('игра: мышь не захвачена — экран входа', await page.isVisible('.v3-pause'));
  await page.screenshot({ path: out + 'play-enter.png' });
  // без паузы — сам мир (скриншот кадра)
  await page.evaluate(() => document.querySelector('.v3-pause')?.setAttribute('style', 'display:none'));
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + 'play-game.png' });
  await page.evaluate(() => document.querySelector('.v3-pause')?.removeAttribute('style'));

  // 3. главное меню → мультиплеер → назад → редактор
  await page.getByRole('button', { name: 'Главное меню' }).click();
  await page.waitForSelector('.play-board', { timeout: 30000 });
  ok('пауза → «Главное меню»: меню', await page.isVisible('.play-board'));
  ok('меню: сессии прогулки нет', await page.evaluate(() => !window.__rfWalk));
  await page.getByRole('menuitem', { name: 'Одиночная игра' }).click();
  ok('одиночная: «Продолжить» доступно', await page.getByRole('menuitem', { name: 'Продолжить' }).isEnabled());
  await page.getByRole('menuitem', { name: 'Назад' }).click();
  await page.getByRole('menuitem', { name: 'Мультиплеер' }).click();
  await page.waitForSelector('.play-sheet .coop-form', { timeout: 30000 });
  ok('мультиплеер: форма лобби (Steam, UUID, создать)', (await page.textContent('.play-sheet')).includes('Создать лобби'));
  await page.screenshot({ path: out + 'play-mp.png' });
  // 4. мультиплеер: создать лобби (relay на этом же vite) → «Играть» → мир лобби — сюжет; пауза — код лобби; выход
  await page.locator('.play-sheet .coop-box', { hasText: 'Создать лобби' }).getByRole('button', { name: 'Создать лобби' }).click();
  await page.waitForSelector('.play-sheet .coop-code[readonly]', { timeout: 30000 });
  const lobby = await page.inputValue('.play-sheet .coop-code[readonly]');
  ok('мультиплеер: лобби создано, код виден', /^[0-9a-f-]{36}$/.test(lobby), lobby);
  await page.getByRole('button', { name: 'Играть' }).click();
  await page.waitForFunction(() => window.__rfWalk && window.__rfCoop && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  ok('лобби: мир лобби — сюжет', await page.evaluate(() => window.__rfWalk.opts.story === true && window.__rfCoop.co.meta?.walk?.story === true));
  ok('лобби: пауза с кодом лобби', (await page.inputValue('.v3-pause-lobby input').catch(() => '')) === lobby);
  ok('лобби: отладки нет', !(await page.$('aside.side')) && !(await page.$('.v3-tools')));
  await page.screenshot({ path: out + 'play-coop.png' });
  await page.getByRole('button', { name: 'Выйти из лобби в меню' }).click();
  await page.waitForSelector('.play-board', { timeout: 30000 });
  ok('лобби → меню: из лобби вышли', await page.evaluate(() => !sessionStorage.getItem('room-forge/coop/active') && !window.__rfWalk));

  await page.getByRole('menuitem', { name: 'Выйти в редактор' }).click();
  await page.waitForSelector('.topbar', { timeout: 30000 });
  ok('«Выйти в редактор»: шапка', await page.isVisible('.topbar'));
} catch (e) {
  ok('без исключений', false, String(e?.message ?? e).slice(0, 400));
} finally {
  await browser.close();
  stopServer();
}
ok('ошибок в консоли нет', !errors.length, errors.slice(0, 5).join(' | '));
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length} FAIL из ${results.length}` : `\nвсе ${results.length} OK`);
process.exit(bad.length ? 1 : 0);
