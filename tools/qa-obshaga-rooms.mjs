// QA комнат общаги в браузере (tmp/smile-wip/CONTRACT.md §9.3, src/view3d/obshagaRoomsView.ts):
//  A  таблички: обычный номер, элитный шестизначный (выглядит так же), ∞ — тёмная с золотом; у двери без номера — пусто;
//  B  запертая дверь: E без ключа — не открывается («Заперто. Нужен ключ»); ключ в руках — «E — отпереть ключом»,
//     E — ключ потрачен, флаг мира «unlock:…», дверь распахнулась;
//  C  записка: листок в комнате, «E — прочитать записку», E — листок с текстом поверх, E — закрыть.
//
//   node tools/qa-obshaga-rooms.mjs [--keep-server]   (скриншоты — tmp/smile-wip/shots/rooms-*.png)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5293;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('../tmp/smile-wip/shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const keep = process.argv.includes('--keep-server');
// без слежения за файлами, свой кэш оптимизатора (tmp/smile-wip/vite.rooms.config.ts)
const server = spawn(`npx vite --config tmp/smile-wip/vite.rooms.config.ts --port ${PORT} --strictPort`, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
for (let k = 0; k < 240 && !/ready in|Local:/.test(serverLog); k++) await new Promise((r) => setTimeout(r, 500));
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

const st = (page) => page.evaluate(() => window.__rfObshaga.state());
const dorm = (page) => page.evaluate(() => window.__rfDorm.state());
const pressE = (page) => page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' })));
const waitFor = async (fn, ms, every = 250) => {
  const t0 = Date.now();
  let v = null;
  while (Date.now() - t0 < ms) {
    v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, every));
  }
  return v;
};

/** Встать в комнате room в точке плана (x, y), глаза — на высоте позы; смотреть на точку Babylon (tx, ty, tz). */
const standLook = (page, room, x, y, tx, ty, tz) =>
  page.evaluate(
    async ({ room, x, y, tx, ty, tz }) => {
      const d = window.__rf3dFold, v = window.__rf3d;
      const cur = d.portal?.current ?? d.current.center;
      if (cur !== room) d.goTo(room);
      await new Promise((r) => setTimeout(r, 300));
      const z = window.__rfObshaga.nav().rooms.get(room)?.z ?? 0;
      const c = v.fps;
      c.position.set(x, z + v.posture.eye + 0.05, -y);
      const dx = tx - c.position.x, dy = ty - c.position.y, dz = tz - c.position.z;
      c.rotation.set(Math.atan2(-dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0);
      c.cameraDirection.setAll(0);
      c.cameraRotation.set(0, 0);
      return { cur: d.portal?.current ?? d.current.center };
    },
    { room, x, y, tx, ty, tz },
  );
/** Перед дверью в коридоре на dist м, лицом к табличке. */
const facePlate = (page, d, dist) => standLook(page, d.cor, d.x + d.nx * dist, d.y + d.ny * dist, d.x, d.z + 1.6, -d.y);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|AudioContext|autoplay/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
  await go(page, BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-rooms-1', deadEndChance: 0.05, branching: 1, aheadDoors: 3, clusters: true, biome: 'obshaga', on: true }));
    localStorage.setItem('room-forge/obshaga-sound', '0');
  });
  for (let k = 0; ; k++) {
    await page.reload({ timeout: 180000 });
    await page.waitForTimeout(1000);
    try {
      await page.evaluate(async () => {
        const { mutate } = await import('/src/model/store.ts');
        mutate((p) => Object.assign(p.world, { trAfter: 100000 }));
      });
      await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 60000 });
      await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rfObshaga && window.__rfDorm, null, { timeout: 180000 });
      break;
    } catch (e) {
      if (k >= 5) throw e;
      errors.length = 0;
      await page.waitForTimeout(8000);
    }
  }
  await page.waitForFunction(() => window.__rf3d.props.ready, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__rfObshaga.calm(true));
  // ручки DORM — тот же модуль, что у страницы (QA меняет их как бестиарий)
  const knobs = (o) => page.evaluate(async (o) => {
    const m = await import('/src/locations/obshagaRooms.ts');
    for (const [k, v] of Object.entries(o)) m.DORM[k] = v;
    return { ...m.DORM };
  }, o);

  const doors = await page.evaluate(() => window.__rfDorm.doors());
  const kinds = doors.reduce((a, d) => ((a[d.kind] = (a[d.kind] ?? 0) + 1), a), {});
  ok('мир: жилые двери с метаданными', doors.length >= 4, JSON.stringify(kinds));
  const pick = (f) => doors.find(f) ?? null;

  // ═════════════════ A: таблички ═════════════════
  const shotPlate = async (d, name, dist = 1.1) => {
    await facePlate(page, d, dist);
    await page.waitForTimeout(1500);
    const s = await dorm(page);
    await page.screenshot({ path: out + `rooms-${name}.png` });
    return s;
  };
  const inf = pick((d) => d.kind === 'inf');
  ok('A ∞ — среди первых комнат локации, заперта', !!inf && inf.locked && /^∞\+\d+$/.test(inf.plate), JSON.stringify(inf && { id: inf.id, plate: inf.plate, k: inf.k }));
  if (inf) {
    const s = await shotPlate(inf, 'plate-inf');
    const p = s.plates.find((x) => x.id === inf.id);
    ok('A ∞: табличка рисуется в комнате полотна', !!p && (s.extras[inf.room] ?? []).some((n) => n.includes(inf.id)), JSON.stringify(p));
    await shotPlate(inf, 'plate-inf-close', 0.55);
  }
  const num = pick((d) => d.kind === 'numbered' && d.plate.length <= 4) ?? pick((d) => d.kind === 'numbered');
  ok('A номерная комната есть', !!num, JSON.stringify(num && { id: num.id, plate: num.plate }));
  if (num) {
    const s = await shotPlate(num, 'plate-num');
    ok('A номер: табличка', s.plates.some((x) => x.id === num.id && x.text === num.plate));
    await shotPlate(num, 'plate-num-close', 0.55);
  }
  const plain = pick((d) => d.kind === 'plain');
  if (plain) {
    const s = await shotPlate(plain, 'plate-plain', 0.8);
    ok('A без номера: таблички нет', !s.plates.some((x) => x.id === plain.id));
  }
  // элитная: шестизначная, вид — как у номерной; в маленьком мире её может не быть — ручкой бестиария
  let elite = pick((d) => d.kind === 'elite');
  if (!elite) {
    await knobs({ eliteChance: 1 });
    await page.waitForTimeout(300);
    elite = (await page.evaluate(() => window.__rfDorm.doors())).find((d) => d.kind === 'elite') ?? null;
  }
  ok('A элитная: шестизначный номер', !!elite && /^\d{6}$/.test(elite.plate), JSON.stringify(elite && { id: elite.id, plate: elite.plate }));
  if (elite) await shotPlate(elite, 'plate-elite-close', 0.55);
  await knobs({ eliteChance: 0.12 });

  // ═════════════════ B: замок и ключ ═════════════════
  const lk = (await page.evaluate(() => window.__rfDorm.doors())).find((d) => d.locked && !d.unlocked && d.kind !== 'inf') ?? inf;
  ok('B запертая дверь есть', !!lk, JSON.stringify(lk && { id: lk.id, kind: lk.kind }));
  if (lk) {
    ok('B ключей в начале нет', (await page.evaluate(() => window.__rfDorm.keys())) === 0);
    await facePlate(page, lk, 1.0);
    await page.waitForTimeout(900);
    const b0 = await st(page);
    ok('B без ключа: подсказка обычная', b0.nearDoor === lk.id && /открыть дверь/.test(b0.prompt ?? ''), JSON.stringify({ near: b0.nearDoor, prompt: b0.prompt }));
    await pressE(page);
    await page.waitForTimeout(250);
    await page.screenshot({ path: out + 'rooms-locked.png' });
    const flash = await page.evaluate(() => document.querySelector('.v3-flash')?.textContent ?? null);
    await page.waitForTimeout(1500);
    const b1 = await st(page);
    ok('B без ключа: E — «Заперто. Нужен ключ», не открылась', /Нужен ключ/.test(flash ?? '') && !(b1.doors[lk.id] > 0), JSON.stringify({ flash, open: b1.doors[lk.id] ?? 0 }));
    const gave = await page.evaluate(() => window.__rfDorm.giveKey(1));
    await page.waitForTimeout(600);
    const b2 = await st(page);
    ok('B ключ в руках: «E — отпереть ключом»', gave && /отпереть ключом/.test(b2.prompt ?? ''), JSON.stringify({ gave, prompt: b2.prompt }));
    await page.screenshot({ path: out + 'rooms-key-prompt.png' });
    await pressE(page);
    await page.waitForTimeout(300);
    const flash2 = await page.evaluate(() => document.querySelector('.v3-flash')?.textContent ?? null);
    const b3 = await waitFor(async () => {
      const s = await st(page);
      return (s.doors[lk.id] ?? 0) >= 0.99 ? s : null;
    }, 6000);
    const after = (await page.evaluate(() => window.__rfDorm.doors())).find((d) => d.id === lk.id);
    const keys = await page.evaluate(() => window.__rfDorm.keys());
    const flag = await page.evaluate((id) => window.__rfWalk.world.flag('unlock:' + id), lk.id);
    ok('B E с ключом: ключ потрачен, флаг мира, дверь распахнулась', !!b3 && keys === 0 && flag && after?.unlocked, JSON.stringify({ flash2, keys, flag, open: b3?.doors[lk.id] }));
    await page.waitForTimeout(500);
    await page.screenshot({ path: out + 'rooms-unlocked.png' });
  }

  // ═════════════════ C: записка ═════════════════
  let nd = (await page.evaluate(() => window.__rfDorm.doors())).find((d) => d.note != null);
  if (!nd) {
    await knobs({ numberedChance: 1, noteChance: 1 });
    await page.waitForTimeout(300);
    nd = (await page.evaluate(() => window.__rfDorm.doors())).find((d) => d.note != null);
  }
  ok('C комната с запиской есть', !!nd, JSON.stringify(nd && { id: nd.id, note: nd.note, plate: nd.plate }));
  if (nd) {
    // войти (телепорт в комнату) и найти листок
    await standLook(page, nd.room, nd.x - nd.nx * 1.0, nd.y - nd.ny * 1.0, nd.x - nd.nx * 3, nd.z + 0.8, -(nd.y - nd.ny * 3));
    const at = await waitFor(() => page.evaluate((r) => window.__rfDorm.noteAt(r), nd.room), 6000);
    ok('C листок лежит в комнате', !!at, JSON.stringify(at));
    if (at) {
      const [X, Y, Z] = at;
      // встать в 0.85 м от листка (со стороны входа), смотреть на него
      const dx = nd.x - X, dy = nd.y + Z, l = Math.hypot(dx, dy) || 1;
      await standLook(page, nd.room, X + (dx / l) * 0.85, -Z + (dy / l) * 0.85, X, Y, Z);
      await page.waitForTimeout(1200);
      const c0 = await dorm(page);
      await page.screenshot({ path: out + 'rooms-note-mesh.png' });
      ok('C «E — прочитать записку»', c0.target === nd.room && c0.prompt, JSON.stringify({ target: c0.target, prompt: c0.prompt }));
      await pressE(page);
      await page.waitForTimeout(600);
      const c1 = await dorm(page);
      const txt = await page.evaluate(() => document.querySelector('.rf-dnote-text')?.textContent ?? null);
      await page.screenshot({ path: out + 'rooms-note-read.png' });
      ok('C E — листок с текстом и номером элитной', c1.reading === nd.room && !!txt && txt.includes(String(nd.note)), JSON.stringify({ reading: c1.reading, txt }));
      await pressE(page);
      await page.waitForTimeout(400);
      const c2 = await dorm(page);
      ok('C E — закрыть', !c2.reading && !(await page.evaluate(() => !!document.querySelector('.rf-dnote'))), JSON.stringify({ reading: c2.reading }));
    }
  }
  await knobs({ numberedChance: 0.25, noteChance: 0.4, eliteChance: 0.12 });
  ok('нет ошибок страницы', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) {
  console.error('QA упал:', e);
  ok('QA прошёл до конца', false, String(e).slice(0, 300));
} finally {
  await browser.close();
  stopServer();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
if (failed.length) process.exitCode = 1;
