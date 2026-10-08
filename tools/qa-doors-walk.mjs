// QA дверей в «Прогулке» (docs/DOORS.md): модели из каталога, анимация открытия, бесшовность.
//  A (хрущёвка): у закрытых выходов — полотна (doorLeaf), не панели; открытие по шагам: ручка нажата → мир растёт →
//    кадр до и после подмены куска (стена → проём) попиксельно совпадает; распах; после — угол как у слота
//    «открытый выход», пересборка куска — без скачка.
//  B (E): настоящая клавиша E у другого выхода — кадры анимации, дверь распахнута, мир вырос; игрок вплотную —
//    отходит, полотно сквозь камеру не проходит.
//  C (перезагрузка): открытая дверь остаётся распахнутой.
//  D (подвал, сарай): выход хаба наверх — железная подвальная / дощатая дверь сарая.
//
//   node tools/qa-doors-walk.mjs [--keep-server]   (скриншоты — tools/qa/doors-*.png)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const PORT = 5233;
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
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
};

const here = (page) => page.evaluate(() => window.__rf3dFold.portal?.current ?? window.__rf3dFold.current.center);

/** Закрытые выходы квартиры игрока (с слотом двери в куске). */
const exitsHere = (page) =>
  page.evaluate(() => {
    const s = window.__rfWalk, d = window.__rf3dFold, w = s.world;
    const room = d.portal?.current ?? d.current.center;
    const cid = w.clusterAt(room)?.id;
    const res = [];
    for (const i of s.rx.instances) {
      if (w.clusterAt(i.id)?.id !== cid) continue;
      for (const k of i.connectors ?? []) if (k.exit) res.push({ inst: i.id, connector: k.id, tag: k.tag, len: k.len });
    }
    return res;
  });

/** Встать в комнате inst перед дверью connector на dist м, лицом к двери (сдвиг вдоль стены — side м). */
const standAtDoor = async (page, inst, connector, dist = 1.0, side = 0) => {
  await page.evaluate((id) => window.__rf3dFold.goTo(id), inst);
  await page.waitForTimeout(800);
  return page.evaluate(
    ({ inst, connector, dist, side }) => {
      const d = window.__rf3dFold.deadEndAt(inst, connector);
      if (!d) return null;
      const c = window.__rf3d.fps;
      // вдоль стены: вправо, если смотреть на дверь (u — внутрь комнаты): r = (−u.z, u.x) в Babylon
      const rx = -d.u.z, rz = d.u.x;
      c.position.set(d.center.x + d.u.x * dist + rx * side, d.center.y + 1.6, d.center.z + d.u.z * dist + rz * side);
      c.rotation.set(0.12, Math.atan2(-d.u.x, -d.u.z), 0);
      c.cameraDirection.setAll(0);
      return { cx: d.center.x, cz: d.center.z, ux: d.u.x, uz: d.u.z };
    },
    { inst, connector, dist, side },
  );
};

/** Снимок области холста (центральная часть — дверь) в сырых пикселях. */
const grab = async (page, name, frac = 0.5) => {
  const box = await page.locator('canvas').first().boundingBox();
  const clip = { x: box.x + box.width * (0.5 - frac / 2), y: box.y + box.height * 0.12, width: box.width * frac, height: box.height * 0.76 };
  const buf = await page.screenshot({ path: name ? out + name : undefined, clip });
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  return { data, info };
};
const diff = (a, b) => {
  let n = 0, sum = 0;
  for (let i = 0; i < a.data.length; i += a.info.channels) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    sum += d;
    if (d > 24) n++;
  }
  const px = a.data.length / a.info.channels;
  return { changed: n / px, mean: sum / px / 3 };
};

const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock/i.test(m.text()) && errors.push(m.text().slice(0, 300)));

  // ═════════════════ A: хрущёвка, открытие по шагам ═════════════════
  await setup(page, 'qa-doors', null, { trAfter: 100000 });
  const ex = await exitsHere(page);
  ok('A у квартиры есть закрытые выходы', ex.length > 0, `${ex.length}: ${ex.map((e) => e.tag).join(', ')}`);
  const e0 = ex[0];
  await standAtDoor(page, e0.inst, e0.connector, 1.1);
  await frames(page, 6);
  const info0 = await page.evaluate(({ inst, connector }) => {
    const d = window.__rf3dFold;
    const slot = d.doorAt(inst, connector);
    const sc = window.__rf3d.scene;
    return {
      slot,
      leaves: sc.meshes.filter((m) => m.name.startsWith(`doorLeaf:${inst}/${connector}:`)).length,
      panels: sc.meshes.filter((m) => m.name.startsWith('deadEnd')).length,
      doorsMeshes: sc.meshes.filter((m) => m.name === 'doors').length,
    };
  }, e0);
  ok('A у выхода — слот двери «выход» и полотно-меш', info0.slot?.role === 'exit' && info0.leaves >= 1, `${info0.slot?.style} ${info0.slot?.role}, полотен ${info0.leaves}`);
  ok('A в кусках есть меши дверей (наличники, распахнутые полотна)', info0.doorsMeshes > 0, `doors ×${info0.doorsMeshes}, панелей тупиков ${info0.panels}`);
  await grab(page, 'doors-a0-closed.png', 0.9);
  // вид наискось, с 2.2 м: кинолента на виртуальных часах аниматора (кадры не зависят от скорости скриншотов)
  const look = await page.evaluate(({ inst, connector }) => {
    const d = window.__rf3dFold, de = d.deadEndAt(inst, connector), slot = d.doorAt(inst, connector);
    const c = window.__rf3d.fps;
    const rx = -de.u.z, rz = de.u.x;
    const side = (slot.hinge === 'left' ? 1 : -1) * 0.55;
    c.position.set(de.center.x + de.u.x * 2.2 + rx * side, de.center.y + 1.6, de.center.z + de.u.z * 2.2 + rz * side);
    c.rotation.set(0.1, Math.atan2(de.center.x - c.position.x, de.center.z - c.position.z), 0);
    c.cameraDirection.setAll(0);
    window.__qaT = 0;
    d.doors.now = () => window.__qaT;
    window.__qaReady = false;
    window.__qaAnim = d.doors.open(slot, { ready: () => window.__qaReady === true });
    return { hinge: slot.hinge, style: slot.style };
  }, e0);
  const film = [];
  const at = async (ms, name) => {
    await page.evaluate((ms) => (window.__qaT = ms), ms);
    await frames(page, 3);
    film.push(name);
    return grab(page, name, 0.9);
  };
  await at(0, 'doors-f00.png');
  await at(150, 'doors-f01.png');
  const before = await at(400, 'doors-f02.png');
  const built0 = await page.evaluate(() => window.__rf3dFold.pieces?.built ?? 0);
  const target = await page.evaluate(({ inst, connector }) => window.__rfWalk.openDoor(inst, connector), e0);
  ok('A мир вырос за дверью', !!target, String(target));
  await page.waitForFunction(({ inst, connector }) => window.__rfWalk.world.doorState(inst, connector) === 'linked' && window.__rf3dFold.doorAt(inst, connector)?.role === 'opened', e0, { timeout: 20000 });
  const after = await at(400, 'doors-f03.png');
  const st = await page.evaluate(({ inst, connector }) => ({ phase: window.__qaAnim.phase, built: window.__rf3dFold.pieces?.built ?? 0, slot: window.__rf3dFold.doorAt(inst, connector) }), e0);
  ok('A кусок пересобран (стена → проём), полотно ещё закрыто', st.built > built0 && st.phase === 'unlatch' && st.slot?.role === 'opened', `кусков ${built0} → ${st.built}, фаза ${st.phase}`);
  const dd = diff(before, after);
  ok('A подмена за закрытым полотном не видна (кадры до/после совпадают)', dd.changed < 0.004 && dd.mean < 1.5, `изменилось ${(dd.changed * 100).toFixed(2)}% пикселей, среднее ${dd.mean.toFixed(2)}`);
  ok('A стиль двери не сменился', st.slot?.style === info0.slot?.style && st.slot?.hinge === info0.slot?.hinge, `${info0.slot?.style}/${info0.slot?.hinge} → ${st.slot?.style}/${st.slot?.hinge}`);
  // готово → распах начинается со следующего кадра (время распаха — от этого момента)
  await page.evaluate(() => (window.__qaReady = true));
  await at(500, 'doors-f04.png');
  const sw = await page.evaluate(() => window.__rf3dFold.doors.anims?.size ?? 0);
  void sw;
  let k = 5;
  for (const ms of [650, 800, 950, 1100, 1250, 1450, 1650, 1900]) await at(ms, `doors-f${String(k++).padStart(2, '0')}.png`);
  await page.evaluate(() => { window.__qaT = 5000; });
  await page.waitForFunction(() => window.__qaAnim.phase === 'done', null, { timeout: 15000 });
  await page.evaluate(() => { window.__rf3dFold.doors.now = () => performance.now(); });
  await frames(page, 4);
  await grab(page, 'doors-a6-open.png', 0.9);
  const pose = await page.evaluate(({ inst, connector }) => {
    const d = window.__rf3dFold;
    const p = d.pieces.peek(inst);
    const dm = p?.bo.doorLeaves.get(`${inst}/${connector}`);
    const slot = d.doorAt(inst, connector);
    if (!dm || !slot) return null;
    const lf = dm.leaves[0];
    return { angle: ((lf.mesh.rotation.y - lf.yaw) * lf.geo.sign * 180) / Math.PI, slot: slot.angle };
  }, e0);
  ok('A после распаха угол полотна = угол слота «открытый выход»', pose && Math.abs(pose.angle - pose.slot) < 0.05, JSON.stringify(pose));
  // пересборка куска после анимации — без скачка
  const s1 = await grab(page, null);
  await page.evaluate(({ inst }) => {
    const d = window.__rf3dFold;
    d.pieces.setRun(d.run, [inst]);
  }, e0);
  await frames(page, 6);
  const s2 = await grab(page, null);
  const d2 = diff(s1, s2);
  ok('A пересборка открытой двери — тот же кадр', d2.changed < 0.004, `изменилось ${(d2.changed * 100).toFixed(2)}%`);

  // ═════════════════ B: клавиша E и отход игрока ═════════════════
  await page.evaluate((id) => window.__rf3dFold.goTo(id), target);
  await page.waitForTimeout(1500);
  const ex2 = await exitsHere(page);
  ok('B в новой квартире есть выходы', ex2.length > 0, String(ex2.length));
  if (ex2.length) {
    const e1 = ex2[0];
    const slot1 = await page.evaluate(({ inst, connector }) => window.__rf3dFold.doorAt(inst, connector), e1);
    // вплотную у свободного края полотна: петли — hinge, свободный край — с другой стороны
    const side = (slot1.hinge === 'left' ? 1 : -1) * slot1.widthM * 0.25;
    await standAtDoor(page, e1.inst, e1.connector, 0.45, side);
    await page.waitForTimeout(500);
    const cam0 = await page.evaluate(() => window.__rf3d.fps.position.asArray());
    const n0 = await page.evaluate(() => window.__rfWalk.rx.instances.length);
    await page.keyboard.press('KeyE');
    const shots = [];
    for (let k = 0; k < 6; k++) {
      await page.waitForTimeout(280);
      shots.push(await page.evaluate(({ inst, connector }) => {
        const d = window.__rf3dFold;
        const dm = d.pieces.peek(inst)?.bo.doorLeaves.get(`${inst}/${connector}`);
        const lf = dm?.leaves[0];
        const c = window.__rf3d.fps.position;
        if (!lf) return null;
        // расстояние от камеры до полотна (отрезок от оси петель до свободного края) — в плане
        const a = lf.mesh.rotation.y;
        const ex = lf.geo.sign * Math.cos(a), ez = -lf.geo.sign * Math.sin(a);
        const px = c.x - lf.mesh.position.x, pz = c.z - lf.mesh.position.z;
        const t = Math.max(0, Math.min(lf.geo.width, px * ex + pz * ez));
        return { dist: Math.hypot(px - ex * t, pz - ez * t), angle: ((a - lf.yaw) * lf.geo.sign * 180) / Math.PI };
      }, e1));
      await grab(page, `doors-b${k}.png`, 0.9);
    }
    await page.waitForFunction(() => window.__rf3dFold.doors.active === 0, null, { timeout: 15000 });
    const n1 = await page.evaluate(() => window.__rfWalk.rx.instances.length);
    const cam1 = await page.evaluate(() => window.__rf3d.fps.position.asArray());
    const st1 = await page.evaluate(({ inst, connector }) => ({ state: window.__rfWalk.world.doorState(inst, connector), slot: window.__rf3dFold.doorAt(inst, connector) }), e1);
    ok('B E — дверь открыта, мир вырос', st1.state === 'linked' && st1.slot?.role === 'opened' && n1 > n0, `${st1.state} ${st1.slot?.role}, комнат ${n0} → ${n1}`);
    const minDist = Math.min(...shots.filter(Boolean).map((s) => s.dist));
    ok('B игрок отошёл, полотно не прошло сквозь камеру', Math.hypot(cam1[0] - cam0[0], cam1[2] - cam0[2]) > 0.05 && minDist > 0.12, `сдвиг ${Math.hypot(cam1[0] - cam0[0], cam1[2] - cam0[2]).toFixed(2)} м, мин. расстояние до полотна ${minDist.toFixed(2)} м; углы ${shots.map((s) => s?.angle.toFixed(0)).join(' ')}`);
    await grab(page, 'doors-b-open.png', 0.9);
    globalThis.__e1 = e1;
  }

  // ═════════════════ C: перезагрузка ═════════════════
  await page.evaluate(() => window.__rfWalk.saveNow());
  await page.reload({ timeout: 180000 });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  const c0 = await page.evaluate(({ inst, connector }) => window.__rf3dFold.doorAt(inst, connector), e0);
  ok('C после перезагрузки открытый выход — распахнутая дверь у той же комнаты', c0?.role === 'opened' && c0.leaf, JSON.stringify(c0 && { role: c0.role, style: c0.style, angle: c0.angle }));

  // ═════════════════ D: подвал и сарай ═════════════════
  for (const [biome, style] of [['basement', 'basement_metal'], ['barn', 'barn_plank']]) {
    await setup(page, 'qa-doors-' + biome, biome, { trAfter: 100000 });
    const exs = await exitsHere(page);
    const stair = exs.find((e) => e.tag === 'stair');
    const sl = stair ? await page.evaluate(({ inst, connector }) => window.__rf3dFold.doorAt(inst, connector), stair) : null;
    ok(`D ${biome}: выход хаба наверх — ${style}`, sl?.style === style && sl.role === 'exit', JSON.stringify(sl && { style: sl.style, role: sl.role }));
    if (stair) {
      await standAtDoor(page, stair.inst, stair.connector, 1.4);
      await frames(page, 6);
      await grab(page, `doors-d-${biome}.png`, 0.9);
    }
  }
} catch (e) {
  errors.push('QA: ' + (e?.stack ?? e));
} finally {
  await browser.close();
  stopServer();
}
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} OK${errors.length ? `; ошибки: ${errors.length}` : ''}`);
if (errors.length) console.log(errors.join('\n'));
process.exitCode = fails.length || errors.length ? 1 : 0;
