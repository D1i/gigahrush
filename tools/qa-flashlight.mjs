// QA фонарика (src/view3d/flashlight.ts) и предметов на полу (src/view3d/worldItems.ts) в «Прогулке» — до их подключения
// к странице: модули берутся тем же графом vite, что и у страницы (import('/src/…') из page.evaluate), и ставятся на
// просмотрщик из DEV-глобалов (window.__rf3d, __rf3dFold). Старт — в подвале (тёмный биом).
//  A: фонарь в руке включён — центр кадра заметно светлее, чем без него; источник фонаря — в списке источников стены
//     текущей комнаты и в пределах maxSimultaneousLights её материала.
//  B: горящий фонарь брошен перед игроком (dropPose) — лёг в текущую комнату на пол, светит (свет пула включён), меши
//     отдаются портальному рендеру; nearest находит его, highlight подсвечивает.
// Свой vite (порт 5249, свой cacheDir — не мешает dev-серверам других сессий). Скриншоты — tools/qa/flash-*.png.
// node tools/qa-flashlight.mjs
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5249;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.qa.config.ts', import.meta.url)),
  root: ROOT,
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-qa-flashlight', import.meta.url)),
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

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // прогрев: vite при первом заходе в 3D догружает зависимости и перезагружает страницу
  await page.goto(BASE, { timeout: 180000 });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rf3d?.props?.ready, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(3000);
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock/i.test(m.text()) && errors.push(m.text().slice(0, 300)));

  // новый мир со стартом в подвале
  await page.goto(BASE, { timeout: 180000 });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-flash', deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, on: true }));
    localStorage.setItem('room-forge/flashlight-sound', '0');
  });
  await page.reload({ timeout: 180000 });
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const { mutate } = await import('/src/model/store.ts');
    mutate((p) => {
      p.world.startBiome = 'basement';
      p.world.trAfter = 100000;
    });
  });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rf3d?.props?.ready, null, { timeout: 180000 });
  await page.waitForTimeout(2500);

  // встать посреди самого большого прямоугольника пола текущей комнаты, смотреть на ближнюю стену (~2–3 м)
  const pose = await page.evaluate(() => {
    const d = window.__rf3dFold, v = window.__rf3d, cam = v.fps;
    const room = d.portal.current;
    const fl = d.pieces.get(room).model.floors.find((f) => f.inst === room);
    const r = fl.rects.reduce((a, b) => ((b.x1 - b.x0) * (b.y1 - b.y0) > (a.x1 - a.x0) * (a.y1 - a.y0) ? b : a));
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    // вдоль короткой стороны — стена ближе
    const alongX = r.x1 - r.x0 < r.y1 - r.y0;
    cam.position.set(cx, cam.position.y, -cy);
    cam.rotation.set(0.08, alongX ? Math.PI / 2 : 0, 0);
    cam.cameraDirection.setAll(0);
    return { room };
  });
  // темнота как в тёмном биоме (Biome.dark — BiomeMood страницы): hemi / sun гаснут, у игрока тусклая лампа
  const dark = await page.evaluate(async () => {
    const { BiomeMood } = await import('/src/view3d/biomeMood.ts');
    const v = window.__rf3d;
    window.__qaMood = new BiomeMood(v.scene);
    window.__qaMood.set(0.92);
    return { hemi: v.scene.getLightByName('hemi')?.intensity, lights: v.scene.lights.filter((l) => l.isEnabled()).map((l) => l.name) };
  });
  console.log('темнота', JSON.stringify(dark));
  console.log('поза', JSON.stringify(pose));
  await page.waitForTimeout(1200);
  const off = await lum(page);
  await page.screenshot({ path: out + 'flash-0-off.png' });

  // ═════════ A: фонарь в руке ═════════
  const a = await page.evaluate(async () => {
    const { Flashlight, LIGHT_SLOTS } = await import('/src/view3d/flashlight.ts');
    const v = window.__rf3d;
    const f = new Flashlight(v.scene, v.fps);
    window.__qaFlash = f;
    let last = performance.now();
    window.__qaFlashObs = v.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now();
      f.update((t - last) / 1000, window.__qaMotion ?? { speed: 0, sprint: 0, crawl: 0 });
      last = t;
    });
    f.setHeld(true);
    f.setOn(true);
    await new Promise((r) => setTimeout(r, 1500));
    // стена текущей комнаты: источник фонаря — в её списке и в пределах предела материала
    const d = window.__rf3dFold;
    const piece = d.pieces.get(d.portal.current);
    const walls = piece.meshes.filter((m) => /wall|facing/i.test(m.name));
    const w = walls[0] ?? piece.meshes[0];
    const idx = w.lightSources.indexOf(f.light);
    const mat = w.material;
    const maxL = mat?.maxSimultaneousLights ?? (mat?.subMaterials?.[0]?.maxSimultaneousLights ?? null);
    const low = v.scene.materials.filter((m) => typeof m.maxSimultaneousLights === 'number' && m.maxSimultaneousLights < LIGHT_SLOTS).map((m) => m.name);
    return { mesh: w.name, idx, n: w.lightSources.length, maxL, intensity: f.light.intensity, low: low.slice(0, 8), lowN: low.length, enabled: v.scene.lights.filter((l) => l.isEnabled()).map((l) => l.name) };
  });
  console.log('A', JSON.stringify(a));
  const on = await lum(page);
  await page.screenshot({ path: out + 'flash-1-on.png' });
  ok('A фонарь светит: центр кадра заметно светлее', on > off * 1.6 + 4, `без ${off.toFixed(1)} → с ${on.toFixed(1)}`);
  ok('A источник фонаря у стены текущей комнаты — в пределах maxSimultaneousLights', a.idx >= 0 && a.maxL != null && a.idx < a.maxL, `#${a.idx} из ${a.n}, предел ${a.maxL}`);
  ok('A у материалов сцены предел источников поднят', a.lowN === 0, a.low.join(', '));
  // ход и бег — скриншоты покачивания
  await page.evaluate(() => (window.__qaMotion = { speed: 4.5, sprint: 1, crawl: 0 }));
  await page.waitForTimeout(700);
  await page.screenshot({ path: out + 'flash-2-sprint.png' });
  await page.evaluate(() => (window.__qaMotion = { speed: 0, sprint: 0, crawl: 0 }));

  // ═════════ B: брошенный горящий фонарь ═════════
  const b = await page.evaluate(async () => {
    const { WorldItems, dropPose, FLASHLIGHT_ITEM } = await import('/src/view3d/worldItems.ts');
    const v = window.__rf3d, d = window.__rf3dFold;
    const f = window.__qaFlash;
    const items = new WorldItems(v.scene, { portal: () => d.portal, shown: () => v.mode === 'fps' && !v.hasOverlay, itemModel: (id) => v.props.get('p_item_' + id.replace(/^it_/, '')) });
    window.__qaItems = items;
    // смотреть вниз, бросить перед собой
    v.fps.rotation.x = 0.75;
    v.fps.computeWorldMatrix(true);
    const p = dropPose(v.scene, v.fps, { inst: d.portal.current, portal: d.portal, eye: v.posture.eye });
    const drops = [
      { id: 'qa1', item: FLASHLIGHT_ITEM, ...p, on: true },
      { id: 'qa2', item: 'it_canned', inst: p.inst, x: p.x + Math.cos(p.yaw) * 0.35, y: p.y, z: p.z - Math.sin(p.yaw) * 0.35, yaw: p.yaw },
    ];
    items.sync(drops, 1);
    f.setHeld(false);
    await new Promise((r) => setTimeout(r, 1200));
    const near = items.nearest(v.fps.position, v.fps.getTarget().subtract(v.fps.position).normalize());
    items.highlight(near?.id ?? null);
    const feet = v.fps.position.y - v.posture.eye;
    return { p, feet, room: d.portal.current, prov: d.portal.extraProviders.size, lit: items.litCount, near: near?.id ?? null, hl: items.highlighted };
  });
  console.log('B', JSON.stringify(b));
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + 'flash-3-drop.png' });
  // при свете (биом не тёмный) — фонарь в руке не пересвечивает
  const lit = await page.evaluate(async () => {
    const v = window.__rf3d;
    window.__qaMood.set(0);
    window.__qaFlash.setHeld(true);
    window.__qaItems.highlight(null);
    v.fps.rotation.x = 0.08;
    await new Promise((r) => setTimeout(r, 800));
    return window.__qaFlash.light.intensity;
  });
  await page.screenshot({ path: out + 'flash-5-lit-room.png' });
  ok('освещённая комната: фонарь слабее, чем в темноте', lit < a.intensity * 0.6, `в темноте ${a.intensity.toFixed(2)}, при свете ${lit.toFixed(2)}`);
  await page.evaluate(() => {
    window.__qaFlash.setHeld(false);
    window.__qaMood.set(0.92);
  });
  ok('B dropPose: в текущей комнате, на полу, ~0.7 м впереди', b.p.inst === b.room && Math.abs(b.p.y - b.feet) < 0.15, JSON.stringify(b.p));
  ok('B предметы отданы портальному рендеру, горящий фонарь светит', b.prov >= 1 && b.lit === 1, `поставщиков ${b.prov}, светит ${b.lit}`);
  ok('B nearest видит брошенное, highlight подсвечивает', !!b.near && b.hl === b.near, `${b.near} / ${b.hl}`);
  // посмотреть на фонарь с другой стороны (линза к камере)
  await page.evaluate(() => {
    const v = window.__rf3d, it = window.__qaItems;
    it.highlight(null);
    const n = v.scene.getTransformNodeByName('drop:qa1');
    const yaw = n.rotation.y;
    v.fps.position.set(n.position.x + Math.sin(yaw) * 1.3, v.fps.position.y, n.position.z + Math.cos(yaw) * 1.3);
    const t = n.position.clone();
    t.y += 0.02;
    v.fps.setTarget(t);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: out + 'flash-4-drop-front.png' });
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
