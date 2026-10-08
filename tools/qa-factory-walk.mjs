// QA «Прогулки» в браузере: биом «Завод» и финал «Болото на крыше» (docs/GENERATOR-4D.md §21, docs/LOCATIONS.md §13).
//  A (завод): старт в биоме «Завод» — сухой цех-хаб, HUD «Завод» и «сухо 0%»; модели набора factory_props.glb; всё
//    крутится — клоны подвижных частей в сцене меняют позу со временем; отделка — кирпич и бетон.
//  B (где влажнее): идём по соседям, где влажнее — ступени сыро → течь → топь (снимки), отделка мокреет; дошли до
//    «Лестницы на крышу» — открылась сцена финала.
//  C (финал): на крыше — шестерня, у неё подсказка; встал на зуб — сценарий, место меняется в темноте, титры «КОНЕЦ»
//    с номером части; «На завод» — снова у двери лестницы; «Новая игра» — мир сида с начала (биом старта).
//
//   node tools/qa-factory-walk.mjs [--keep-server]   (скриншоты — tools/qa/factory-*.png)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5237;
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

/** Где игрок: комната, квартира, влажность. */
const where = (page) =>
  page.evaluate(() => {
    const d = window.__rf3dFold, w = window.__rfWalk.world;
    const room = d.portal?.current ?? d.current.center;
    const cl = w.clusterAt(room);
    return { room, roomId: w.run().instances.find((i) => i.id === room)?.roomId, biome: cl?.biome?.id ?? null, wet: w.wetAt(room), n: w.run().instances.length };
  });

const setup = async (page, seed, biome, world = {}) => {
  await go(page, BASE);
  await page.evaluate(({ seed, biome }) => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed, deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, biome, on: true }));
  }, { seed, biome });
  await page.reload({ timeout: 180000 });
  await page.waitForTimeout(1000);
  await page.evaluate(async ({ world }) => {
    const { mutate } = await import('/src/model/store.ts');
    mutate((p) => Object.assign(p.world, world));
  }, { world });
  // холодный vite иногда перезагружает страницу (оптимизация зависимостей) — тогда ещё раз
  for (let k = 0; ; k++) {
    try {
      await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 60000 });
      await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
      break;
    } catch (e) {
      if (k >= 2) throw e;
      await page.screenshot({ path: out + `factory-setup-retry${k}.png` });
      await page.reload({ timeout: 180000 });
      await page.waitForTimeout(3000);
    }
  }
  await page.waitForTimeout(1500);
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|AudioContext/i.test(m.text()) && errors.push(m.text().slice(0, 300)));

  // ═════════════════ A: завод ═════════════════
  await setup(page, 'qa-factory', 'factory', { trAfter: 100000 });
  const a0 = await where(page);
  ok('A старт в заводе: сухой цех-хаб, влажность 0', a0.biome === 'factory' && /^fac_hub_0$/.test(a0.roomId) && a0.wet?.w === 0, JSON.stringify(a0));
  await page.waitForTimeout(800);
  const hud = await page.evaluate(() => document.querySelector('.v3-walkhud')?.textContent ?? '');
  ok('A HUD — «Завод» и «сухо 0%»', hud.includes('Завод') && /сухо 0%/.test(hud), hud);
  const fin = await page.evaluate(() => window.__rfWalk.world.run().content.map((c) => [c.finish?.wall, c.finish?.floor]));
  ok('A отделка цехов — набор пользователя (кирпич, бетон)', fin.length > 0 && fin.every(([wl, fl]) => /^f_(bsm_|concrete)/.test(wl ?? '') && /^f_bsm_/.test(fl ?? '')), JSON.stringify(fin.slice(0, 3)));
  // модели грузятся по очереди (подвал, сарай, завод) — дождаться и пересборки кусков с ними
  await page.waitForFunction(() => window.__rf3d.props.ready, null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  const models = await page.evaluate(() => ({
    gear: !!window.__rf3d.props.get('p_fac_gear_large'),
    rotors: window.__rf3d.props.rotorsOf('p_fac_gear_pair').length,
  }));
  ok('A модели завода загружены, у пары шестерён — две подвижные части', models.gear && models.rotors === 2, JSON.stringify(models));
  // всё крутится: клоны подвижных частей в сцене меняют позу
  const spin = await page.evaluate(async () => {
    const sc = window.__rf3d.scene;
    const rot = sc.meshes.filter((m) => m.name.includes('.rotor:') && m.isEnabled());
    const pose = () => rot.map((m) => (m.rotationQuaternion ? m.rotationQuaternion.asArray().concat(m.position.asArray()) : [0]).map((v) => v.toFixed(4)).join(','));
    const a = pose();
    await new Promise((r) => setTimeout(r, 700));
    const b = pose();
    return { n: rot.length, moved: a.filter((x, i) => x !== b[i]).length, animated: window.__rf3d.props.animated };
  });
  ok('A всё крутится: подвижные части клонов меняют позу', spin.n > 0 && spin.moved > 0, JSON.stringify(spin));
  await page.screenshot({ path: out + 'factory-1-hub.png' });

  // ═════════════════ B: туда, где влажнее ═════════════════
  const seen = new Set([a0.room]);
  let cur = a0.room;
  const levels = new Set([0]);
  let swamp = null;
  const path = [];
  for (let step = 0; step < 120 && !swamp; step++) {
    const next = await page.evaluate(
      ({ cur, seen }) => {
        const s = window.__rfWalk, w = s.world;
        w.ensureAround?.(cur);
        const run = w.run();
        const nb = [];
        for (const l of run.links) {
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
    path.push(next.swamp ? 'болото' : next.wet?.w.toFixed(2));
    if (next.swamp) {
      swamp = next.id;
      break;
    }
    await page.evaluate((id) => window.__rf3dFold.goTo(id), cur);
    await page.waitForTimeout(250);
    const lv = next.wet?.level ?? 0;
    if (!levels.has(lv)) {
      levels.add(lv);
      await page.waitForTimeout(900);
      await page.screenshot({ path: out + `factory-2-level${lv}.png` });
    }
  }
  ok('B по мокрым соседям — ступени сыро, течь, топь', [1, 2, 3].every((k) => levels.has(k)), [...levels].join(','));
  ok('B дошли до болота: «Лестница на крышу»', !!swamp, `${path.length} кусков: ${path.join(' ')}`);
  const wetFin = await page.evaluate(() => {
    const s = window.__rfWalk, w = s.world, run = w.run();
    return run.instances.filter((i) => w.wetAt(i.id)?.level === 3).map((i) => run.content[run.instances.indexOf(i)]?.finish?.floor);
  });
  ok('B в топи пол — вода или сырой бетон', wetFin.length > 0 && wetFin.every((f) => /^f_bsm_(water|damp_floor)$/.test(f ?? '')), JSON.stringify(wetFin.slice(0, 4)));

  // ═════════════════ C: финал ═════════════════
  if (swamp) {
    await page.evaluate((id) => window.__rf3dFold.goTo(id), swamp);
    await page.waitForFunction(() => !!window.__rfSwamp?.ready, null, { timeout: 300000 });
    await page.waitForTimeout(1500);
    const s0 = await page.evaluate(() => window.__rfSwamp.qaState());
    ok('C вход в комнату — сцена финала: крыша, шестерня', s0.place === 'roof' && s0.models > 20 && s0.boxes > 10, JSON.stringify({ place: s0.place, models: s0.models, rotors: s0.rotors }));
    await page.screenshot({ path: out + 'factory-3-roof.png' });
    // подойти к зубу: подсказка
    await page.evaluate(() => {
      const s = window.__rfSwamp, z = s.qaState().stepZone;
      s.place(z.x - 0.6, z.z - 2.2, -0.3, -0.1);
    });
    await page.waitForTimeout(700);
    const prompt = await page.evaluate(() => document.querySelector('.v3-lift-prompt')?.textContent ?? window.__rfSwamp.qaState().hud.prompt);
    ok('C у шестерни подсказка «встань на зуб»', /зуб/.test(prompt ?? ''), prompt);
    await page.screenshot({ path: out + 'factory-4-gear.png' });
    // встать на зуб — сценарий (живьём, 20 с)
    await page.evaluate(() => {
      const s = window.__rfSwamp, z = s.qaState().stepZone;
      s.place(z.x, z.z);
    });
    await page.waitForFunction(() => window.__rfSwamp.qaState().endT !== null, null, { timeout: 10000 });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: out + 'factory-5-press.png' });
    await page.waitForFunction(() => window.__rfSwamp.qaState().place === 'base', null, { timeout: 15000 });
    await page.waitForTimeout(3200);
    await page.screenshot({ path: out + 'factory-6-emerge.png' });
    await page.waitForFunction(() => (window.__rfSwamp.qaState().endT ?? 0) > 20.2, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    const end = await page.evaluate(() => ({ h1: document.querySelector('.v3-end h1')?.textContent, text: document.querySelector('.v3-end')?.textContent, btns: [...document.querySelectorAll('.v3-end-btns button')].map((b) => b.textContent) }));
    const unit = await page.evaluate(() => window.__rfSwamp.qaState().hud.titles.lines[1]);
    ok('C титры «КОНЕЦ» с номером части и кнопками', end.h1 === 'КОНЕЦ' && /Войсковая часть \d+/.test(end.text ?? '') && end.btns.length === 3, `${unit} · ${end.btns.join(' / ')}`);
    await page.screenshot({ path: out + 'factory-7-end.png' });
    // «На завод» — к двери лестницы
    await page.getByRole('button', { name: 'На завод' }).click();
    await page.waitForTimeout(1500);
    const c1 = await where(page);
    ok('C «На завод»: сцена закрыта, игрок у двери лестницы', !(await page.evaluate(() => window.__rf3d.hasOverlay)) && c1.room !== swamp && c1.biome === 'factory', JSON.stringify(c1));
    // ещё раз — и «Новая игра»
    await page.evaluate((id) => window.__rf3dFold.goTo(id), swamp);
    await page.waitForFunction(() => !!window.__rfSwamp?.ready, null, { timeout: 300000 });
    await page.evaluate(() => {
      const s = window.__rfSwamp, z = s.qaState().stepZone;
      s.place(z.x, z.z);
    });
    await page.waitForFunction(() => (window.__rfSwamp?.qaState().endT ?? 0) > 20.2, null, { timeout: 40000 });
    const keyBefore = await page.evaluate(() => window.__rfWalk.key);
    await page.getByRole('button', { name: 'Новая игра' }).click();
    await page.waitForFunction((k) => window.__rfWalk && window.__rfWalk.key !== k && window.__rf3dFold?.portal?.isActive, keyBefore, { timeout: 180000 });
    await page.waitForTimeout(1500);
    const c2 = await where(page);
    ok('C «Новая игра»: мир сида с начала — биом старта проекта, мир маленький', c2.biome === 'khrush' && c2.n < 60, JSON.stringify(c2));
  }

  ok('ошибок на странице нет', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) {
  console.error(e);
  ok('скрипт дошёл до конца', false, String(e?.message ?? e));
} finally {
  await browser.close();
  stopServer();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} OK`);
  process.exit(bad.length ? 1 : 0);
}
