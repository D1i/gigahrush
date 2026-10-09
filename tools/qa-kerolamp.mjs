// QA керосиновой лампы общаги как предмета хотбара (src/view3d/inventory.ts, it_kerolamp; docs/GAMEPLAY.md §8,
// docs/LOCATIONS.md §14) — в браузере, клавишами, со скриншотами:
//  K1 у лампы на споте в вахтёрской — «E — взять керосиновую лампу»; хотбар полон — E: «Руки заняты», лампа на месте;
//  K2 E — лампа в хотбаре (выбрана), в руке: модель у камеры и тёплый свет; общага: держит, защищён;
//  K3 1 — в руке фонарь, лампа убрана (не держит); 2 — снова лампа;
//  K4 G — лампа стоит на полу (предмет мира), у игрока не в руке; рядом — защищён полем лампы на полу; свет у лампы на полу
//     (если его уже рисует worldItems); в темноте рука к стоящему у лампы не подходит ближе поля и не хватает;
//  K5 отошёл дальше поля — не защищён; вернулся, взгляд на лампу — «E — подобрать: Керосиновая лампа», E — снова в руке;
//  K6 старое сохранение (`${key}/obsh-lamp` = '1', до хотбара): перезагрузка — лампа в хотбаре и в руке, ключ стёрт.
// Свой vite (порт 5271, свой cacheDir — не мешает dev-серверам других сессий). Скриншоты — tools/qa/kero-*.png.
//   node tools/qa-kerolamp.mjs
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5271;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.qa.config.ts', import.meta.url)),
  root: ROOT,
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-qa-kerolamp', import.meta.url)),
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
const LAMP = 'it_kerolamp';

/** Встать в комнате room в точке плана (x, y), лицом к точке плана (tx, ty), взгляд вниз на pitch. */
const standAt = (page, room, x, y, tx, ty, pitch = 0.04) =>
  page.evaluate(
    async ({ room, x, y, tx, ty, pitch }) => {
      const d = window.__rf3dFold, v = window.__rf3d;
      const cur = d.portal?.current ?? d.current.center;
      if (cur !== room) d.goTo(room);
      await new Promise((r) => setTimeout(r, 300));
      const z = window.__rfObshaga.nav().rooms.get(room)?.z ?? 0;
      const c = v.fps;
      c.position.set(x, z + v.posture.eye + 0.05, -y);
      c.rotation.set(pitch, Math.atan2(tx - x, -(ty - y)), 0);
      c.cameraDirection.setAll(0);
      c.cameraRotation.set(0, 0);
      return { cur: d.portal?.current ?? d.current.center };
    },
    { room, x, y, tx, ty, pitch },
  );

/** Состояние: хотбар, лампа и фонарь в руке, общага, предметы на полу, подсказки, вспышка. */
const st = (page) =>
  page.evaluate(() => {
    const q = window.__rfInv, O = window.__rfObshaga, w = window.__rfWalk, v = window.__rf3d;
    const s = O.state();
    const slots = [...document.querySelectorAll('.v3-hotbar .v3-slot')].map((el) => ({ sel: el.classList.contains('sel'), title: el.getAttribute('title') }));
    const c = v.fps.position;
    return {
      hotbar: q.hotbar(),
      lamp: q.lamp(),
      flash: q.flash(),
      aimed: q.aimed()?.item ?? null,
      heldModel: v.scene.meshes.some((m) => m.name === 'obsh:heldLanternModel' && m.isEnabled()),
      holding: s.holding,
      prot: O.protectedNow(),
      floor: O.floorLamps(),
      obshPrompt: s.prompt,
      nearLamp: s.nearLamp,
      drops: w.drops().map((d) => ({ id: d.id, item: d.item, inst: d.inst, x: +d.x.toFixed(2), y: +d.y.toFixed(2), z: +d.z.toFixed(2) })),
      prompts: [...document.querySelectorAll('.v3-stage .v3-lift-prompt')].map((e) => e.textContent),
      flashMsg: document.querySelector('.v3-flash')?.textContent ?? null,
      heldName: document.querySelector('.v3-held')?.textContent ?? null,
      slots,
      pos: { x: c.x, y: -c.z },
      room: window.__rf3dFold.portal?.current ?? null,
      dead: s.dead,
      dragging: s.dragging,
    };
  });
const wait = async (page, fn, ms) => {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < ms) {
    s = await st(page);
    if (fn(s)) return s;
    await page.waitForTimeout(200);
  }
  return s;
};
const key = async (page, code) => {
  await page.keyboard.press(code);
  await page.waitForTimeout(250);
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // прогрев: vite при первом заходе в 3D догружает зависимости и перезагружает страницу
  await page.goto(BASE, { timeout: 180000 });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-kero-warm', clusters: true, biome: 'obshaga', on: true }));
  });
  await page.reload({ timeout: 180000 });
  await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 120000 });
  await page.waitForFunction(() => window.__rf3d?.props?.ready, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(3000);
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|AudioContext|autoplay/i.test(m.text()) && errors.push(m.text().slice(0, 300)));

  await page.goto(BASE, { timeout: 180000 });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-obsh-1', deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, biome: 'obshaga', on: true }));
    localStorage.setItem('room-forge/obshaga-sound', '0');
    localStorage.setItem('room-forge/flashlight-sound', '0');
    localStorage.setItem('room-forge/breath-sound', '0');
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
      await page.waitForFunction(() => window.__rfWalk && window.__rfInv && window.__rf3dFold?.portal?.isActive && window.__rfObshaga, null, { timeout: 120000 });
      break;
    } catch (e) {
      if (k >= 4) throw e;
      errors.length = 0;
      await page.waitForTimeout(6000);
    }
  }
  await page.waitForFunction(() => window.__rf3d.props.ready, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__rfObshaga.calm(true));

  // ═════════ K1: лампа на споте ═════════
  const lamp = await page.evaluate(() => {
    const nav = window.__rfObshaga.nav();
    const s = window.__rfWalk;
    const l = nav.lamps.find((x) => s.rx.instances.find((i) => i.id === x.inst)?.roomTags.includes('вахтёрская')) ?? nav.lamps[0];
    if (!l) return null;
    const r = nav.rooms.get(l.inst);
    return { ...l, cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2 };
  });
  ok('K1 лампа на споте (вахтёрская)', !!lamp, JSON.stringify(lamp));
  if (!lamp) throw new Error('нет лампы');
  const dx = lamp.cx - lamp.x, dy = lamp.cy - lamp.y, dl = Math.hypot(dx, dy) || 1;
  const P = { x: lamp.x + (dx / dl) * 0.8, y: lamp.y + (dy / dl) * 0.8 };
  await standAt(page, lamp.inst, P.x, P.y, lamp.x, lamp.y, 0.6);
  await page.waitForTimeout(1200);
  const k0 = await st(page);
  ok('K1 у лампы — «E — взять керосиновую лампу»', k0.nearLamp === `${lamp.inst}/${lamp.spot}` && /взять керосиновую лампу/.test(k0.obshPrompt ?? ''), JSON.stringify({ near: k0.nearLamp, prompt: k0.obshPrompt, prompts: k0.prompts }));
  ok('K1 до лампы: в руке фонарь, лампы нет, не защищён', !k0.holding && !k0.lamp.held && k0.flash.held && !k0.prot, JSON.stringify({ hotbar: k0.hotbar, prot: k0.prot }));
  // хотбар полон — E: «Руки заняты», операция не ушла
  await page.evaluate(() => {
    for (let k = 0; k < 4; k++) window.__rfInv.inv.receive({ item: 'it_canned' });
    window.__rfInv.inv.select(0);
  });
  await page.waitForTimeout(300);
  // вспышки — записывать все (живут ~1.2 с)
  await page.evaluate(() => {
    window.__keroFlash = [];
    new MutationObserver(() => {
      const t = document.querySelector('.v3-flash')?.textContent;
      if (t && window.__keroFlash.at(-1) !== t) window.__keroFlash.push(t);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const kfull = await st(page);
  await key(page, 'KeyE');
  await page.waitForTimeout(300);
  const kf = await st(page);
  const flashes = await page.evaluate(() => window.__keroFlash);
  const taken0 = await page.evaluate(({ inst, spot }) => window.__rfWalk.world.lampTaken(inst, spot), lamp);
  ok('K1 хотбар полон — E: «Руки заняты», лампа осталась на споте', flashes.some((t) => /Руки заняты/.test(t)) && !taken0 && !kf.hotbar.slots.some((s) => s?.item === 'it_kerolamp'), JSON.stringify({ flashes, taken0, before: kfull.hotbar, prompt: kfull.obshPrompt, near: kfull.nearLamp, after: kf.hotbar }));
  await page.evaluate(() => window.__rfInv.inv.qaHold('it_canned', false));
  await page.waitForTimeout(1300);
  await page.screenshot({ path: out + 'kero-1-spot.png' });

  // ═════════ K2: E — лампа в хотбаре и в руке ═════════
  await key(page, 'KeyE');
  const k2 = await wait(page, (s) => s.lamp.held && s.heldModel, 5000);
  const taken = await page.evaluate(({ inst, spot }) => window.__rfWalk.world.lampTaken(inst, spot), lamp);
  const sel = k2.hotbar.slots[k2.hotbar.sel];
  ok('K2 E — лампа в хотбаре, выбрана; спот пуст', sel?.item === LAMP && taken && k2.slots[k2.hotbar.sel]?.sel && k2.slots[k2.hotbar.sel]?.title === 'Керосиновая лампа', JSON.stringify({ hotbar: k2.hotbar, taken, slot: k2.slots[k2.hotbar.sel] }));
  ok('K2 в руке: модель у камеры и тёплый свет; фонаря нет', k2.heldModel && k2.lamp.shown && k2.lamp.light && k2.lamp.intensity > 0.5 && !k2.flash.held, JSON.stringify({ lamp: k2.lamp, flash: k2.flash }));
  ok('K2 общага: держит лампу, защищён', k2.holding && k2.prot, JSON.stringify({ holding: k2.holding, prot: k2.prot }));
  await page.evaluate(() => (window.__rf3d.fps.rotation.x = 0.04));
  await page.waitForTimeout(700);
  await page.screenshot({ path: out + 'kero-2-in-hand.png' });
  const lampSlot = k2.hotbar.sel;

  // ═════════ K3: 1 — фонарь, лампа убрана; снова лампа ═════════
  await key(page, 'Digit1');
  const k3 = await wait(page, (s) => s.flash.held && !s.lamp.shown, 3000);
  ok('K3 1 — в руке фонарь (правая), лампа убрана: не держит, без поля', k3.flash.held && k3.flash.hand === 1 && !k3.lamp.shown && !k3.lamp.light && !k3.heldModel && !k3.holding && !k3.prot, JSON.stringify({ flash: k3.flash, lamp: k3.lamp, holding: k3.holding, prot: k3.prot }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + 'kero-3-flashlight.png' });
  await key(page, `Digit${lampSlot + 1}`);
  const k3b = await wait(page, (s) => s.lamp.shown, 3000);
  ok('K3 снова лампа — в руке', k3b.lamp.shown && k3b.holding && !k3b.flash.held, JSON.stringify(k3b.lamp));

  // ═════════ K4: G — лампа на полу ═════════
  await page.evaluate(() => (window.__rf3d.fps.rotation.x = 0.55));
  await page.waitForTimeout(300);
  await key(page, 'KeyG');
  const k4 = await wait(page, (s) => s.drops.some((d) => d.item === LAMP), 5000);
  const dropped = k4.drops.find((d) => d.item === LAMP);
  ok('K4 G — лампа стоит на полу (предмет мира), в руке пусто, хотбар без лампы', !!dropped && !k4.lamp.held && !k4.lamp.shown && !k4.hotbar.slots.some((s) => s?.item === LAMP), JSON.stringify({ dropped, hotbar: k4.hotbar }));
  ok('K4 общага видит лампу на полу (поле)', k4.floor.length === 1 && Math.abs(k4.floor[0].x - dropped.x) < 0.01 && Math.abs(k4.floor[0].y + dropped.z) < 0.01 && k4.floor[0].room === dropped.inst, JSON.stringify(k4.floor));
  ok('K4 рядом с лампой на полу (без лампы в руке) — защищён', !k4.holding && k4.prot, JSON.stringify({ holding: k4.holding, prot: k4.prot, me: k4.pos }));
  await page.waitForTimeout(900);
  const glow = await page.evaluate((d) => {
    const v = window.__rf3d;
    return v.scene.lights
      .filter((l) => l.isEnabled() && l.intensity > 0 && l.getClassName() === 'PointLight' && Math.hypot(l.position.x - d.x, l.position.z - d.z) < 1)
      .map((l) => ({ name: l.name, i: +l.intensity.toFixed(2) }));
  }, dropped);
  ok('K4 лампа на полу светит (тёплый точечный свет у неё — worldItems)', glow.length > 0, JSON.stringify(glow));
  await page.screenshot({ path: out + 'kero-4-on-floor.png' });
  // в темноте рука к стоящему у лампы на полу не подходит ближе поля и не хватает
  await page.evaluate(() => window.__rfObshaga.forceBlackout(true));
  await page.waitForTimeout(600);
  const hd = await page.evaluate(() => window.__rfObshaga.spawnHandNear());
  ok('K4 темно, рука вылезла', !!hd, String(hd));
  if (hd) {
    const door = await page.evaluate((id) => window.__rfObshaga.nav().doorById.get(id), hd);
    // спиной к двери руки — её не видят: ползёт
    if (door) await page.evaluate(({ x, y }) => {
      const c = window.__rf3d.fps;
      c.rotation.y = Math.atan2(x - c.position.x, -y - c.position.z) + Math.PI;
      c.rotation.x = 0.3;
    }, door);
    let minD = Infinity, grabbed = false, lastHand = null;
    for (let k = 0; k < 30; k++) {
      await page.waitForTimeout(400);
      const s = await page.evaluate((d) => {
        const O = window.__rfObshaga.state();
        return { hand: O.hand, dragging: O.dragging, dead: O.dead, dTip: O.hand ? Math.hypot(O.hand.tip.x - d.x, O.hand.tip.y + d.z) : null };
      }, dropped);
      if (s.dragging || s.dead) grabbed = true;
      if (s.dTip !== null) minD = Math.min(minD, s.dTip);
      lastHand = s.hand;
    }
    ok('K4 рука не хватает стоящего у лампы на полу и не заходит в её поле (3 м)', !grabbed && minD > 2.85, JSON.stringify({ grabbed, minTipToLamp: +minD.toFixed(2), hand: lastHand && { phase: lastHand.phase, blocked: lastHand.blocked, length: lastHand.length } }));
    await page.screenshot({ path: out + 'kero-5-dark-floor-lamp.png' });
  }
  await page.evaluate(() => window.__rfObshaga.lightsBack());
  await page.waitForTimeout(1500);

  // ═════════ K5: отошёл — не защищён; вернулся — подобрал ═════════
  const far = await page.evaluate((d) => {
    const nav = window.__rfObshaga.nav();
    // точка в общаге в 4–14 м от лампы (по прямой), на полу построенного куска; ближайшая из таких
    const lx = d.x, ly = -d.z;
    const portal = window.__rf3dFold.portal;
    let best = null;
    for (const [id, r] of nav.rooms) {
      if (!r.obsh || r.stair || Math.abs((r.z ?? 0) - (nav.rooms.get(d.inst)?.z ?? 0)) > 0.5) continue;
      const rects = portal.cache.peek(id)?.floor ?? [{ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }];
      for (const q of rects)
        for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]]) {
          const x = q.x0 + (q.x1 - q.x0) * fx, y = q.y0 + (q.y1 - q.y0) * fy;
          const dist = Math.hypot(x - lx, y - ly);
          if (dist > 4 && dist < 14 && (!best || dist < best.dist)) best = { room: id, x, y, dist };
        }
    }
    return best;
  }, dropped);
  ok('K5 есть куда отойти дальше поля', !!far, JSON.stringify(far));
  if (far) {
    await standAt(page, far.room, far.x, far.y, dropped.x, -dropped.z);
    await page.waitForTimeout(800);
    const k5 = await st(page);
    ok('K5 отошёл дальше поля (> 3 м) — не защищён', !k5.prot && !k5.holding, JSON.stringify({ prot: k5.prot, room: k5.room, dist: +Math.hypot(k5.pos.x - dropped.x, k5.pos.y + dropped.z).toFixed(2) }));
  }
  // вернуться и посмотреть на лампу: подсказка «подобрать», E — снова в руке
  await standAt(page, lamp.inst, P.x, P.y, dropped.x, -dropped.z, 0.6);
  const k6 = await wait(page, (s) => s.aimed === LAMP, 4000);
  ok('K5 взгляд на лампу — «E — подобрать: Керосиновая лампа»', k6.aimed === LAMP && k6.prompts.some((t) => /подобрать: Керосиновая лампа/.test(t)), JSON.stringify({ aimed: k6.aimed, prompts: k6.prompts }));
  await page.screenshot({ path: out + 'kero-6-pick-prompt.png' });
  await key(page, 'KeyE');
  const k7 = await wait(page, (s) => s.lamp.shown, 5000);
  ok('K5 E — лампа снова в хотбаре и в руке, на полу её нет', k7.lamp.held && k7.lamp.shown && !k7.drops.some((d) => d.item === LAMP) && k7.floor.length === 0, JSON.stringify({ hotbar: k7.hotbar, drops: k7.drops }));

  // ═════════ K6: старое сохранение «лампа в руке» ═════════
  const wkey = await page.evaluate(() => {
    const k = window.__rfWalk.key;
    window.__rfInv.inv.qaHold('it_kerolamp', false);
    window.__rfInv.inv.select(0);
    return k;
  });
  await page.waitForTimeout(400);
  // уйти (pagehide пишет хотбар и мир), затем как старое сохранение: хотбара нет, «лампа в руке» — '1'
  await page.goto('about:blank');
  await page.goto(BASE, { timeout: 180000 });
  await page.evaluate((k) => {
    localStorage.removeItem(k + '/hotbar');
    localStorage.setItem(k + '/obsh-lamp', '1');
  }, wkey);
  await page.reload({ timeout: 180000 });
  await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 60000 });
  await page.waitForFunction(() => window.__rfWalk && window.__rfInv && window.__rfObshaga, null, { timeout: 120000 });
  // лампа в руке с первого кадра, модели предметов догружаются позже — модель в руке должна появиться и тогда
  await page.waitForFunction(() => window.__rf3d.props.ready, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const m = await page.evaluate((k) => ({
    hotbar: window.__rfInv.hotbar(), legacy: localStorage.getItem(k + '/obsh-lamp'), saved: localStorage.getItem(k + '/hotbar'), lamp: window.__rfInv.lamp(), holding: window.__rfObshaga.state().holding,
    model: window.__rf3d.scene.meshes.some((x) => x.name === 'obsh:heldLanternModel' && x.isEnabled()),
  }), wkey);
  ok('K6 старое сохранение «лампа в руке»: лампа в хотбаре и выбрана, ключ стёрт, хотбар записан', m.hotbar.slots[m.hotbar.sel]?.item === LAMP && m.legacy === null && m.holding && /it_kerolamp/.test(m.saved ?? ''), JSON.stringify(m));
  ok('K6 после перезагрузки лампа в руке — с моделью (модели предметов догрузились позже)', m.model && m.lamp.shown, JSON.stringify({ model: m.model, lamp: m.lamp }));
  await page.evaluate(() => (window.__rf3d.fps.rotation.x = 0.04));
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + 'kero-7-migrated.png' });
} catch (e) {
  ok('без исключений', false, String(e?.stack ?? e));
} finally {
  ok('нет ошибок страницы', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  await server.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} OK`);
  process.exit(bad.length ? 1 : 0);
}
