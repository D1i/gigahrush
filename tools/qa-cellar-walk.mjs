// QA «Прогулки» в земляном погребе (src/view3d/cellarWalk.ts, docs/LOCATIONS.md §19) — с оболочкой из земли
// (src/view3d/cellarMesh.ts: стены, пол и потолок болванки спрятаны, коробки стен — невидимые коллайдеры). Клавиши —
// зажатые, как у игрока (W/A/D, E, F); поворот мышью — приращениями cameraRotation (так его даёт ввод мыши).
//  A (старт в камере-хабе): комната с меткой 'погреб' и 'хаб', тело-эллипс, туман погреба, свет у игрока почти погашен;
//    оболочка на месте, спрятанная болванка не рисуется (нет z-fighting); темнота без фонаря (яркость кадра).
//  B (ход 0.6 м): W — идёшь как обычно (не боком), крепь в кадре; шов кусков.
//  C (устье щели грудью вперёд): W — не пролезает, подсказка «повернись боком».
//  D (боком в щели): лицом к стене D/A — протискивается (side, медленнее, руки на стене), камера не влезает в землю
//    (до оболочки дальше ближней плоскости), руки — лучи в бугры земли; поворот упирается ~50°; прошёл щель.
//  F (клетушка за щелью 0.4 м): из хода боком в щель в стене — в клетушку.
//  E (обвал): треск → обвал (проём завален в мире) → засыпан → E ×12 — откопался → у кучи E — разгребать (куча меньше).
//  P (fps): погреб против снежных ходов (тот же swiftshader), цена кадра CellarWalk и рук.
// Свой vite (порт 5263, свой cacheDir). Скриншоты — tmp/cellar-qa/*.png.
//   node tools/qa-cellar-walk.mjs
//   QA_ONLY=hands QA_TUNES='[{"scale":0.7}]' node tools/qa-cellar-walk.mjs   — только руки (подбор позы)
//   QA_W=1920 QA_H=1080 — другой размер окна (руки по краям кадра — от его пропорций)
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const PORT = 5263;
const ONLY = process.env.QA_ONLY || '';
const TUNES = process.env.QA_TUNES ? JSON.parse(process.env.QA_TUNES) : [];
const VW = Number(process.env.QA_W) || 1280, VH = Number(process.env.QA_H) || 800;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('../tmp/cellar-qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.qa.config.ts', import.meta.url)),
  root: ROOT,
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-qa-cellar', import.meta.url)),
  server: { port: PORT, strictPort: true },
  logLevel: 'warn',
});
await server.listen();
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
const frames = (page, n) => page.evaluate(async (n) => { for (let k = 0; k < n; k++) await new Promise((r) => requestAnimationFrame(() => r())); }, n);
const shot = async (page, name) => {
  await frames(page, 2);
  await page.screenshot({ path: out + name + '.png' });
  console.log('  shot', 'tmp/cellar-qa/' + name + '.png');
};
/** Средняя яркость холста сцены 0…255 (без панелей). */
const luma = async (page) => {
  await frames(page, 2);
  const r = await page.evaluate(() => {
    const b = window.__rf3d.scene.getEngine().getRenderingCanvas().getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  const buf = await page.screenshot({ clip: r });
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  let s = 0;
  for (let i = 0; i < data.length; i += info.channels) s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  return s / (data.length / info.channels);
};
/** fps движка, среднее за ms. */
const fps = async (page, ms = 3000) => {
  const xs = [];
  for (let t = 0; t < ms; t += 250) {
    await sleep(250);
    xs.push(await page.evaluate(() => window.__rf3d.scene.getEngine().getFps()));
  }
  return xs.reduce((a, b) => a + b, 0) / xs.length;
};

const where = (page) =>
  page.evaluate(() => {
    const d = window.__rf3dFold, w = window.__rfWalk.world, c = window.__rf3d.fps;
    const room = d.portal?.current ?? d.current.center;
    const inst = window.__rfWalk.rx.instances.find((i) => i.id === room);
    return {
      room, roomId: inst?.roomId, tags: inst?.roomTags, biome: w.clusterAt(room)?.biome?.id ?? null,
      cam: [c.position.x, c.position.y, c.position.z], yaw: c.rotation.y, speed: c.speed, fog: [window.__rf3d.scene.fogStart, window.__rf3d.scene.fogEnd],
      cel: window.__rfCellar.qa(),
    };
  });

/**
 * Оболочка куска под ногами: до неё от глаза (точно — до треугольников рядом), ближняя плоскость камеры (до её углов), в
 * куске нет видимых стен / пола / потолка болванки (их заменяет оболочка — иначе z-fighting), оболочка среди видимых.
 */
const shellCheck = (page) =>
  page.evaluate(() => {
    const d = window.__rf3dFold, sc = window.__rf3d.scene, c = window.__rf3d.fps;
    const room = d.portal?.current ?? d.current.center;
    const m = sc.getMeshByName(`cellar:${room}:earth`);
    const piece = d.portal?.peek?.(room) ?? null;
    const HIDDEN = new Set(['wall', 'partition', 'lintel', 'column', 'floor', 'portalFloor', 'ceiling', 'portalCeiling', 'facing']);
    const blockoutVisible = piece ? piece.meshes.filter((x) => x.isVisible && HIDDEN.has(x.metadata?.kind)).map((x) => x.name) : null;
    const shellDrawn = piece ? piece.meshes.includes(m) : null;
    if (!m) return { room, shell: false, blockoutVisible, shellDrawn };
    const inv = m.getWorldMatrix().clone().invert();
    const V = c.position.constructor;
    const p = V.TransformCoordinates(c.position, inv);
    const pos = m.getVerticesData('position'), idx = m.getIndices();
    // ближайшая точка треугольника (Эриксон)
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const P = [p.x, p.y, p.z];
    const closest = (a, b, cc) => {
      const ab = sub(b, a), ac = sub(cc, a), ap = sub(P, a);
      const d1 = dot(ab, ap), d2 = dot(ac, ap);
      if (d1 <= 0 && d2 <= 0) return a;
      const bp = sub(P, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
      if (d3 >= 0 && d4 <= d3) return b;
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]; }
      const cp = sub(P, cc), d5 = dot(ab, cp), d6 = dot(ac, cp);
      if (d6 >= 0 && d5 <= d6) return cc;
      const vb = d5 * d2 - d1 * d6;
      if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]; }
      const va = d3 * d6 - d5 * d4;
      if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return [b[0] + (cc[0] - b[0]) * w, b[1] + (cc[1] - b[1]) * w, b[2] + (cc[2] - b[2]) * w]; }
      const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
      return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
    };
    let best = Infinity;
    const vx = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    for (let t = 0; t < idx.length; t += 3) {
      const a = vx(idx[t]);
      if (Math.abs(a[0] - P[0]) > 0.5 || Math.abs(a[1] - P[1]) > 0.5 || Math.abs(a[2] - P[2]) > 0.5) continue;
      const q = closest(a, vx(idx[t + 1]), vx(idx[t + 2]));
      const dd = Math.hypot(q[0] - P[0], q[1] - P[1], q[2] - P[2]);
      if (dd < best) best = dd;
    }
    const eng = sc.getEngine(), asp = eng.getAspectRatio(c), ty = Math.tan(c.fov / 2), tx = ty * asp;
    return { room, shell: true, gap: best, near: c.minZ * Math.hypot(1, tx, ty), minZ: c.minZ, blockoutVisible, shellDrawn, tris: idx.length / 3 };
  });

/** Куски погреба с меткой tag рядом (по расстоянию от камеры): устья (середины проёмов), ось. */
const findPieces = (page, tag, not = []) =>
  page.evaluate(({ tag, not }) => {
    const rx = window.__rfWalk.rx, cm = rx.cellM;
    const c = window.__rf3d.fps.position;
    const list = rx.instances.filter((i) => i.roomTags[0] === 'погреб' && i.roomTags.includes(tag) && !not.some((t) => i.roomTags.includes(t)));
    const geo = list.map((i) => {
      const b = i.bbox;
      const cx = ((b.x0 + b.x1) / 2) * cm, cz = -((b.y0 + b.y1) / 2) * cm;
      const ends = i.connectors.filter((k) => k.len >= 1).map((k) => ({ id: k.id, tag: k.tag, side: k.side, x: ((k.line[0] + k.line[2]) / 2) * cm, z: -((k.line[1] + k.line[3]) / 2) * cm, w: k.len * cm, to: k.linkedTo?.inst ?? null, toConn: k.linkedTo?.connector ?? null }));
      return { id: i.id, roomId: i.roomId, tags: i.roomTags, cx, cz, w: (b.x1 - b.x0) * cm, d: (b.y1 - b.y0) * cm, ends, dist: Math.hypot(cx - c.x, cz - c.z) };
    });
    return geo.sort((a, b) => a.dist - b.dist);
  }, { tag, not });

/** Держать клавиши ms (Playwright — как игрок). */
const hold = async (page, keys, ms) => {
  for (const k of keys) await page.keyboard.down(k);
  await sleep(ms);
};
const release = async (page, keys) => {
  for (const k of keys) await page.keyboard.up(k);
};
/** В кусок id, на место (x, z) Babylon, взгляд yaw (и наклон pitch). */
const place = async (page, id, x, z, yaw, pitch = 0.12) => {
  await page.evaluate(({ id, x, z, yaw, pitch }) => {
    window.__rf3dFold.goTo(id);
    const c = window.__rf3d.fps;
    c.position.x = x;
    c.position.z = z;
    c.rotation.set(pitch, yaw, 0);
    c.cameraDirection.setAll(0);
  }, { id, x, z, yaw, pitch });
  await sleep(1500);
  // кусок мог подвинуть камеру (вход в него) — ещё раз
  await page.evaluate(({ x, z, yaw }) => {
    const c = window.__rf3d.fps;
    c.position.x = x;
    c.position.z = z;
    c.rotation.y = yaw;
  }, { x, z, yaw });
  await sleep(500);
};
/** Вдоль оси (ux, uz) от точки (x0, z0). */
const alongOf = (p, x0, z0, ux, uz) => (p.cam[0] - x0) * ux + (p.cam[2] - z0) * uz;

let cellarFps = null;
try {
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock/i.test(m.text()) && errors.push(m.text().slice(0, 300)));

  // ═════════════════ A: старт в погребе (камера-хаб) ═════════════════
  // первый заход: vite может доуложить зависимости и перезагрузить страницу посреди перехода — ещё раз
  for (let k = 0; ; k++) {
    try {
      await page.goto(BASE, { timeout: 180000 });
      break;
    } catch (e) {
      if (k >= 2) throw e;
      await sleep(3000);
    }
  }
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-cellar', deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, biome: 'cellar', on: true }));
  });
  await page.reload({ timeout: 180000 });
  await sleep(1000);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rfCellar, null, { timeout: 180000 });
  await sleep(3000);
  const a0 = await where(page);
  // фокус на холст (клавиши камеры Babylon — с холста)
  await page.mouse.click(VW / 2, VH / 2);
  await sleep(300);
  if (!ONLY) {
    ok('A старт: камера-хаб погреба, биом cellar', a0.tags?.[0] === 'погреб' && a0.tags?.includes('хаб'), `${a0.roomId} [${a0.tags}] биом ${a0.biome}`);
    {
      // полуразмеры по осям мира — от поворота взгляда: x = √((a·cos ψ)² + (b·sin ψ)²), z = √((a·sin ψ)² + (b·cos ψ)²)
      const ex = Math.hypot(0.23 * Math.cos(a0.yaw), 0.13 * Math.sin(a0.yaw)), ez = Math.hypot(0.23 * Math.sin(a0.yaw), 0.13 * Math.cos(a0.yaw));
      ok('A тело-эллипс по взгляду', a0.cel.on && a0.cel.body && Math.abs(a0.cel.ell.x - ex) < 0.005 && Math.abs(a0.cel.ell.z - ez) < 0.005, `${JSON.stringify(a0.cel.ell)} при ψ ${a0.yaw.toFixed(2)}`);
    }
    ok('A туман погреба 0.6…4.5', Math.abs(a0.fog[0] - 0.6) < 1e-6 && Math.abs(a0.fog[1] - 4.5) < 1e-6, JSON.stringify(a0.fog));
    const lamp = await page.evaluate(() => {
      const l = window.__rf3d.scene.getLightByName('mood:lamp');
      return l ? { i: l.intensity, r: l.range } : null;
    });
    ok('A свет у игрока почти погашен', lamp && lamp.i <= 0.1 && lamp.r <= 1.6, JSON.stringify(lamp));
    const sh = await shellCheck(page);
    ok('A оболочка земли в куске, болванка (стены, пол, потолок) не рисуется', sh.shell && sh.shellDrawn && sh.blockoutVisible?.length === 0, JSON.stringify({ shell: sh.shell, drawn: sh.shellDrawn, blockout: sh.blockoutVisible, tris: sh.tris }));
    await shot(page, 'a-hub-flash');
    // хаб: оглядеться
    await page.evaluate(() => (window.__rf3d.fps.rotation.y += Math.PI * 0.6));
    await sleep(600);
    await shot(page, 'a-hub-look');
    const torch0 = await page.evaluate(() => window.__rfInv?.flash?.() ?? null);
    console.log('  фонарь', JSON.stringify(torch0));
    const lOn = await luma(page);
    await page.keyboard.press('KeyF');
    await sleep(600);
    const lOff = await luma(page);
    await shot(page, 'a-hub-dark');
    ok('A без фонаря почти черно (яркость кадра)', lOff < 6 && lOff < lOn * 0.5, `с фонарём ${lOn.toFixed(1)}, без ${lOff.toFixed(1)} из 255`);
    await page.keyboard.press('KeyF');
    await sleep(400);
  }

  // ═════════════════ B: ход 0.6 м — W, как обычно ═════════════════
  if (!ONLY) {
    let pass = await findPieces(page, 'ход', ['щель', 'поворот', 'развилка']);
    pass = pass.filter((p) => p.ends.length >= 2 && p.roomId.startsWith('cel_pass_') && Math.min(p.w, p.d) < 0.7 && Math.max(p.w, p.d) >= 1.9);
    ok('B ход 0.6 м есть в мире', pass.length > 0, pass.length ? `${pass[0].id} ${pass[0].roomId} ${pass[0].w.toFixed(1)}×${pass[0].d.toFixed(1)}` : '');
    if (pass.length) {
      const s = pass[0];
      const end = s.ends.find((e) => e.tag === 'cellar') ?? s.ends[0];
      const ux = Math.abs(end.x - s.cx) > Math.abs(end.z - s.cz) ? Math.sign(s.cx - end.x) : 0;
      const uz = ux ? 0 : Math.sign(s.cz - end.z);
      await place(page, s.id, end.x + ux * 0.35, end.z + uz * 0.35, Math.atan2(ux, uz), 0.05);
      const b0 = await where(page);
      await hold(page, ['KeyW'], 1500);
      const b1 = await where(page);
      await shot(page, 'b-pass-forward');
      await release(page, ['KeyW']);
      const d = alongOf(b1, end.x, end.z, ux, uz) - alongOf(b0, end.x, end.z, ux, uz);
      ok('B в ходе 0.6 м — W идёт как обычно (не боком)', d > 0.6 && !b1.cel.side, `прошёл ${d.toFixed(2)} м, боком ${b1.cel.side}, ширина ${JSON.stringify(b1.cel.width)}, комната ${b1.roomId}`);
      const frames3d = await page.evaluate(() => window.__rf3d.scene.meshes.filter((m) => /cel_frame/.test(m.name) && m.isEnabled()).length);
      console.log('  мешей крепи', frames3d);
      // вдоль хода к шву кусков (устье напротив) — посмотреть, нет ли щелей
      const sh = await shellCheck(page);
      ok('B оболочка хода, болванка не рисуется', sh.shell && sh.shellDrawn && sh.blockoutVisible?.length === 0, JSON.stringify({ gap: sh.gap?.toFixed(3), blockout: sh.blockoutVisible }));
    }
  }

  // ═════════════════ C: щель грудью вперёд ═════════════════
  let slits = await findPieces(page, 'щель');
  for (let k = 0; k < 10 && !slits.length; k++) {
    await sleep(1000);
    slits = await findPieces(page, 'щель');
  }
  ok('C щель есть в мире', slits.length > 0, slits.length ? `${slits[0].id} ${slits[0].roomId} ${slits[0].w.toFixed(1)}×${slits[0].d.toFixed(1)}` : '');
  if (slits.length) {
    const s = slits[0];
    const end = s.ends[0];
    // в кусок щели, в устье (0.1 м от проёма), лицом вдоль щели — к её середине
    const ux = Math.abs(end.x - s.cx) > Math.abs(end.z - s.cz) ? Math.sign(s.cx - end.x) : 0;
    const uz = ux ? 0 : Math.sign(s.cz - end.z);
    const along = (p) => alongOf(p, end.x, end.z, ux, uz);
    await place(page, s.id, end.x + ux * 0.1, end.z + uz * 0.1, Math.atan2(ux, uz));
    const yawWall = Math.atan2(ux, uz) - Math.PI / 2;
    const rx = Math.cos(yawWall), rz = -Math.sin(yawWall);
    const key = rx * ux + rz * uz > 0 ? 'KeyD' : 'KeyA';
    if (!ONLY) {
      const b0 = await where(page);
      await hold(page, ['KeyW'], 1800);
      const b1 = await where(page);
      await shot(page, 'c-slit-forward-blocked');
      await release(page, ['KeyW']);
      ok('C грудью вперёд — не пролез (дальше устья не ушёл)', along(b1) < 0.3, `вглубь ${along(b0).toFixed(3)} → ${along(b1).toFixed(3)} м; комната ${b1.roomId}`);
      ok('C подсказка «повернись боком»', /боком/.test(b1.cel.hud.hint ?? ''), b1.cel.hud.hint ?? '—');
    }

    // ═════════════════ D: боком ═════════════════
    // лицом к стене: поворот на 90° (вправо — ход в сторону D)
    await page.evaluate((yaw) => (window.__rf3d.fps.rotation.y = yaw), yawWall);
    await sleep(400);
    const c0 = await where(page);
    if (ONLY === 'hands') {
      // по кадрам: где, боком ли, скорость, длительность кадра
      await page.keyboard.down(key);
      const tr = await page.evaluate(async ({ ex, ez, ux, uz }) => {
        const c = window.__rf3d.fps, eng = window.__rf3d.scene.getEngine(), out = [];
        const t0 = performance.now();
        while (performance.now() - t0 < 1600) {
          await new Promise((r) => requestAnimationFrame(() => r()));
          const q = window.__rfCellar.qa();
          out.push([Math.round(performance.now() - t0), +((c.position.x - ex) * ux + (c.position.z - ez) * uz).toFixed(3), q.side ? 1 : 0, +c.speed.toFixed(3), Math.round(eng.getDeltaTime()), +c.cameraDirection.length().toFixed(3)]);
        }
        return out;
      }, { ex: end.x, ez: end.z, ux, uz });
      console.log('  кадры [мс, вдоль, боком, speed, dt, |dir|]:', JSON.stringify(tr));
      await release(page, [key]);
    } else await hold(page, [key], 1600);
    const c1 = await where(page);
    await shot(page, 'd-sidestep-mid');
    if (ONLY === 'hands') {
      // подбор позы рук: стоит в щели (дыхание), идёт (перехват), под углом к стене
      const log = async (tag) => {
        const q = await where(page);
        console.log(`  ${tag}: ${q.roomId} along ${along(q).toFixed(2)} side ${q.cel.side} hands ${q.cel.hands} rays ${q.cel.rays} wall ${JSON.stringify(q.cel.wall)} perf ${JSON.stringify(q.cel.perf)}`);
      };
      await log('mid');
      console.log('  свет', JSON.stringify(await page.evaluate(() => window.__rf3d.scene.lights.filter((l) => l.isEnabled() && l.intensity > 0).map((l) => [l.name, +l.intensity.toFixed(3), l.range]))));
      await release(page, [key]);
      await sleep(500);
      await log('released');
      await shot(page, 'h-still');
      for (let i = 0; i < TUNES.length; i++) {
        await page.evaluate((t) => Object.assign(window.__rfCellar.hands.tune, t), TUNES[i]);
        // туда-обратно (из щели не уходить): снимок — посреди шага (кадр в swiftshader долгий — клавиша уже отпущена)
        await hold(page, [i % 2 ? key : key === 'KeyD' ? 'KeyA' : 'KeyD'], 250);
        await release(page, ['KeyA', 'KeyD']);
        await shot(page, `h-tune${i}-walk`);
        await sleep(400);
        await shot(page, `h-tune${i}-still`);
        await log(`tune${i}`);
      }
      await page.evaluate(() => (window.__rf3d.fps.cameraRotation.y += 0.25));
      await sleep(800);
      await shot(page, 'h-turned');
      const q = await where(page);
      console.log('  руки', JSON.stringify({ hands: q.cel.hands, rays: q.cel.rays, shell: q.cel.shell, perf: q.cel.perf, wall: q.cel.wall }));
      throw new Error('QA_ONLY=hands — дальше не идём');
    }
    const sh = await shellCheck(page);
    ok('D боком: side, скорость ниже, руки на стене (лучи в землю оболочки)', c1.cel.side && c1.cel.hands && c1.speed < 0.12 && c1.cel.shell && c1.cel.rays > 0, `side ${c1.cel.side} руки ${c1.cel.hands} лучей ${c1.cel.rays} скорость ${c1.speed.toFixed(3)} ширина ${JSON.stringify(c1.cel.width)}`);
    ok('D камера не влезает в землю: до оболочки дальше ближней плоскости', sh.shell && sh.gap > sh.near + 0.01, `до земли ${sh.gap?.toFixed(3)} м, ближняя плоскость (до углов) ${sh.near?.toFixed(3)} м, стена по лучам ${c1.cel.wall?.dist?.toFixed(3)}`);
    // прижат к стене: стоит, дышит
    await release(page, [key]);
    await sleep(700);
    await shot(page, 'd-sidestep-still');
    const c1b = await where(page);
    ok('D стоит в щели — руки остаются на стене', c1b.cel.side && c1b.cel.hands, `side ${c1b.cel.side} руки ${c1b.cel.hands}`);

    // ═════════════════ поворот в щели (мышью — к «лицом вдоль») ═════════════════
    if (c1.cel.side) {
      const wall0 = c1.yaw;
      await page.evaluate(async () => {
        const c = window.__rf3d.fps;
        for (let k = 0; k < 60; k++) {
          c.cameraRotation.y += 0.03;
          await new Promise((r) => requestAnimationFrame(() => r()));
        }
      });
      await sleep(150);
      const d1 = await where(page);
      const turned = Math.abs(((d1.yaw - wall0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      ok('D поворот в щели упирается (~50°), подсказка «тесно»', turned < 54 * Math.PI / 180 && turned > 35 * Math.PI / 180 && /Тесно/.test(d1.cel.hud.hint ?? ''), `${(turned * 180 / Math.PI).toFixed(1)}°, подсказка: ${d1.cel.hud.hint ?? '—'}`);
      const sh2 = await shellCheck(page);
      ok('D у предела поворота камера не влезает в землю', sh2.gap > sh2.near + 0.01, `до земли ${sh2.gap?.toFixed(3)} м`);
      await shot(page, 'd-turn-limit');
      await page.evaluate((yaw) => (window.__rf3d.fps.rotation.y = yaw), wall0);
      await sleep(300);
    }
    // по щели до конца: по пути — замеры до земли
    let minGap = Infinity;
    for (let k = 0; k < 5; k++) {
      await hold(page, [key], 520);
      const g = await shellCheck(page);
      if (g.shell && Number.isFinite(g.gap)) minGap = Math.min(minGap, g.gap);
    }
    const c2 = await where(page);
    await shot(page, 'd-sidestep-exit');
    await release(page, [key]);
    ok('D боком — прошёл щель', along(c2) > along(c0) + 1.0, `${along(c0).toFixed(2)} → ${along(c1).toFixed(2)} → ${along(c2).toFixed(2)} м (${key}), комната ${c2.roomId}`);
    ok('D по всей щели до земли дальше ближней плоскости', minGap > 0.075, `меньше всего ${minGap.toFixed(3)} м`);
  }

  // ═════════════════ F: клетушка за щелью 0.4 м ═════════════════
  {
    let bins = await findPieces(page, 'клетушка');
    // мир растёт вокруг игрока: пройтись по дальним кускам, пока не найдётся клетушка
    for (let k = 0; k < 14 && !bins.some((b) => b.ends.some((e) => e.to)); k++) {
      const far = await page.evaluate((k) => {
        const rx = window.__rfWalk.rx, cm = rx.cellM;
        const open = rx.instances.filter((i) => i.roomTags[0] === 'погреб' && i.connectors.some((c) => !c.linkedTo && c.tag === 'cellar'));
        const pick = open[(k * 7) % Math.max(1, open.length)];
        if (!pick) return null;
        const rows = pick.cells[0].split(':');
        const y = +rows[0], x = +rows[1].split(/[,-]/)[0];
        return { id: pick.id, x: (x + 0.5) * cm, z: -(y + 0.5) * cm };
      }, k);
      if (!far) break;
      await place(page, far.id, far.x, far.z, 0, 0);
      bins = await findPieces(page, 'клетушка');
    }
    const bin = bins.find((b) => b.ends.some((e) => e.to));
    ok('F клетушка за щелью есть в мире', !!bin, bin ? `${bin.id} ${bin.roomId}` : `кусков ${bins.length}`);
    if (bin) {
      const e = bin.ends.find((q) => q.to);
      // проём со стороны хода: середина, наружу из хода — в клетушку
      const door = await page.evaluate(({ inst, conn }) => {
        const rx = window.__rfWalk.rx, cm = rx.cellM;
        const i = rx.instances.find((q) => q.id === inst);
        const k = i?.connectors.find((q) => q.id === conn);
        if (!i || !k) return null;
        const OUT = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
        const [ox, oy] = OUT[k.side];
        return { inst, roomId: i.roomId, x: ((k.line[0] + k.line[2]) / 2) * cm, y: ((k.line[1] + k.line[3]) / 2) * cm, ox, oy, w: k.len * cm };
      }, { inst: e.to, conn: e.toConn });
      if (door) {
        // Babylon: наружу (в клетушку) — (ox, −oy); стоим в ходе в 0.3 м от стены, лицом вдоль хода
        const nx = door.ox, nz = -door.oy;
        const sx = door.x - door.ox * 0.3, sz = -(door.y - door.oy * 0.3);
        const yaw = Math.atan2(-nz, nx); // вперёд (sin ψ, cos ψ) ⟂ (nx, nz)
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        const key = rx * nx + rz * nz > 0 ? 'KeyD' : 'KeyA';
        await place(page, door.inst, sx, sz, yaw, 0.1);
        const f0 = await where(page);
        await hold(page, [key], 900);
        const f1 = await where(page);
        await shot(page, 'f-bin-slit');
        await hold(page, [key], 1600);
        await release(page, [key]);
        const f2 = await where(page);
        ok('F в щели в клетушку — боком', f1.cel.side || f2.cel.side, `side ${f1.cel.side}/${f2.cel.side}, ширина ${JSON.stringify(f1.cel.width)}, ${f0.roomId} → ${f1.roomId}`);
        ok('F боком через щель 0.4 м — в клетушке', f2.tags?.includes('клетушка'), `${door.roomId} (${door.w.toFixed(1)} м) → ${f2.roomId}`);
        // повернуться в клетушку и посмотреть
        await page.evaluate(({ nx, nz }) => window.__rf3d.fps.rotation.set(0.15, Math.atan2(nx, nz), 0), { nx, nz });
        await hold(page, ['KeyW'], 500);
        await release(page, ['KeyW']);
        await sleep(500);
        await shot(page, 'f-bin-inside');
        const sh = await shellCheck(page);
        ok('F клетушка: оболочка, болванка не рисуется', sh.shell && sh.shellDrawn && sh.blockoutVisible?.length === 0, JSON.stringify({ room: sh.room, blockout: sh.blockoutVisible }));
        // назад — к щели, посмотреть на её устье изнутри
        await page.evaluate(({ nx, nz }) => window.__rf3d.fps.rotation.set(0.1, Math.atan2(-nx, -nz), 0), { nx, nz });
        await sleep(600);
        await shot(page, 'f-bin-back-to-slit');
      }
    }
  }

  // ═════════════════ E: обвал ═════════════════
  /** Повернуться к точке плана (x, y) — Babylon (x, −y). */
  const face = (x, y) => page.evaluate(({ x, y }) => {
    const c = window.__rf3d.fps;
    c.rotation.set(0.25, Math.atan2(x - c.position.x, -y - c.position.z), 0);
  }, { x, y });
  if (!ONLY) {
    // в ход (метры обвала копятся только в узком)
    const pass = (await findPieces(page, 'ход', ['развилка'])).filter((p) => p.ends.length >= 2 && p.ends.every((e) => e.to));
    if (pass.length) {
      const s = pass[0], end = s.ends[0];
      const ux = Math.abs(end.x - s.cx) > Math.abs(end.z - s.cz) ? Math.sign(s.cx - end.x) : 0;
      const uz = ux ? 0 : Math.sign(s.cz - end.z);
      await place(page, s.id, end.x + ux * 0.6, end.z + uz * 0.6, Math.atan2(ux, uz));
    }
    await page.evaluate(() => {
      const W = window.__rfCellar;
      W.collapse.next = W.collapse.crawled + 0.3;
    });
    const e0 = await where(page);
    let phase = e0.cel.phase;
    for (let k = 0; k < 12 && phase === 'calm'; k++) {
      await hold(page, [k % 2 ? 'KeyS' : 'KeyW'], 600);
      await release(page, ['KeyW', 'KeyS']);
      phase = (await where(page)).cel.phase;
    }
    ok('E треск перед обвалом', phase === 'warn' || phase === 'buried', phase);
    if (phase === 'warn') {
      const site = await page.evaluate(() => window.__rfCellar.collapse.site);
      if (site) await face(site.x, site.y);
      await sleep(500);
      await shot(page, 'e-crack');
    }
    await sleep(2600);
    const e1 = await where(page);
    const collapsedAny = await page.evaluate(() => window.__rfWalk.rx.instances.some((i) => i.connectors.some((k) => k.collapsed)));
    ok('E обвал: проём завален в мире', collapsedAny, e1.cel.phase);
    await shot(page, e1.cel.phase === 'buried' ? 'e-buried' : 'e-after-fall');
    if (e1.cel.phase === 'buried') {
      for (let k = 0; k < 13; k++) {
        await page.keyboard.press('KeyE');
        await sleep(120);
      }
      const e2 = await where(page);
      ok('E откопался (E ×12)', e2.cel.phase === 'calm', e2.cel.phase);
    }
    // к завалу: куча земли у проёма (оболочка кладёт её сама), подойти, E — разгребать
    const plug = await page.evaluate(() => {
      const d = window.__rf3dFold, rx = window.__rfWalk.rx, cm = rx.cellM;
      const room = d.portal?.current ?? d.current.center;
      const inst = rx.instances.find((i) => i.id === room);
      const k = inst?.connectors.find((q) => q.collapsed);
      return k ? { room, conn: k.id, x: ((k.line[0] + k.line[2]) / 2) * cm, y: ((k.line[1] + k.line[3]) / 2) * cm } : null;
    });
    ok('E завал в куске игрока', !!plug, JSON.stringify(plug));
    if (plug) {
      await face(plug.x, plug.y);
      await sleep(1500);
      const e3 = await where(page);
      console.log('  пыль', e3.cel.dust.toFixed(2), 'туман', JSON.stringify(e3.fog));
      await shot(page, 'e-dust-heap');
      await sleep(6500);
      await face(plug.x, plug.y);
      await hold(page, ['KeyW'], 900);
      await release(page, ['KeyW']);
      await sleep(400);
      const shell0 = await page.evaluate((room) => {
        const m = window.__rf3d.scene.getMeshByName(`cellar:${room}:earth`);
        return m ? { id: m.uniqueId, v: m.getTotalVertices() } : null;
      }, plug.room);
      await shot(page, 'e-heap-settled');
      const h0 = await where(page);
      ok('E у кучи — подсказка «разгребать»', /разгребать/.test(h0.cel.hud.prompt ?? ''), h0.cel.hud.prompt ?? '—');
      const p0 = await page.evaluate(({ room, conn }) => window.__rfWalk.world.collapseProgress(room, conn), plug);
      for (let k = 0; k < 8; k++) {
        await page.keyboard.press('KeyE');
        await sleep(150);
      }
      await sleep(2500);
      const p1 = await page.evaluate(({ room, conn }) => window.__rfWalk.world.collapseProgress(room, conn), plug);
      const shell1 = await page.evaluate((room) => {
        const m = window.__rf3d.scene.getMeshByName(`cellar:${room}:earth`);
        return m ? { id: m.uniqueId, v: m.getTotalVertices() } : null;
      }, plug.room);
      await shot(page, 'e-heap-dug');
      ok('E разгребает: раскопка растёт (8 × 1/20), куча перестроена', p1 !== null && p1 - (p0 ?? 0) > 0.35 && shell1 && shell0 && shell1.id !== shell0.id, `раскопка ${p0} → ${p1}, оболочка ${JSON.stringify(shell0)} → ${JSON.stringify(shell1)}`);
      console.log('  звук', JSON.stringify(e3.cel.audio), 'пылинок', e3.cel.motes);
    }
  }

  // ═════════════════ P: fps и цена кадра ═════════════════
  if (!ONLY) {
    const s = (await findPieces(page, 'щель'))[0];
    if (s) {
      const end = s.ends[0];
      const ux = Math.abs(end.x - s.cx) > Math.abs(end.z - s.cz) ? Math.sign(s.cx - end.x) : 0;
      const uz = ux ? 0 : Math.sign(s.cz - end.z);
      await place(page, s.id, end.x + ux * 0.1, end.z + uz * 0.1, Math.atan2(ux, uz), 0.05);
    }
    cellarFps = await fps(page);
    const q = await where(page);
    console.log(`  погреб: ${cellarFps.toFixed(1)} fps, CellarWalk кадр ${q.cel.perf.frame.toFixed(3)} мс, ввод ${q.cel.perf.input.toFixed(3)} мс, руки ${q.cel.perf.hands.toFixed(3)} мс`);
    // боком (руки и лучи) — цена рук
    const yawWall = q.yaw - Math.PI / 2;
    await page.evaluate((yaw) => (window.__rf3d.fps.rotation.y = yaw), yawWall);
    await hold(page, ['KeyD'], 1200);
    await release(page, ['KeyD']);
    await hold(page, ['KeyA'], 1200);
    await release(page, ['KeyA']);
    const q2 = await where(page);
    console.log(`  боком: CellarWalk кадр ${q2.cel.perf.frame.toFixed(3)} мс, руки ${q2.cel.perf.hands.toFixed(3)} мс (лучей ${q2.cel.rays}), ввод ${q2.cel.perf.input.toFixed(3)} мс`);
    ok('P цена кадра погреба (CellarWalk + руки) меньше 2 мс', q2.cel.perf.frame + q2.cel.perf.input < 2, `${(q2.cel.perf.frame + q2.cel.perf.input).toFixed(3)} мс`);
    // для сравнения — снежные ходы (тот же swiftshader)
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-snow', deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, biome: 'snow', on: true }));
    });
    await page.reload({ timeout: 180000 });
    await sleep(1000);
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
    await sleep(4000);
    const snowFps = await fps(page);
    console.log(`  снег: ${snowFps.toFixed(1)} fps`);
    ok('P fps погреба не хуже снежных ходов вдвое', cellarFps > snowFps * 0.5, `погреб ${cellarFps.toFixed(1)}, снег ${snowFps.toFixed(1)} (swiftshader)`);
  }
} catch (e) {
  if (!/QA_ONLY/.test(String(e))) {
    console.error(e);
    errors.push(String(e));
  }
} finally {
  await browser.close();
  await server.close();
}
console.log('\nошибки страницы:', errors.length ? errors.slice(0, 10) : 'нет');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAILED ${failed.length}/${results.length}` : `ALL OK ${results.length}`);
process.exit(failed.length || errors.length ? 1 : 0);
