// QA «Фрактальной станции» в настоящем приложении (tmp/metro-wip/FRACTAL.md §9): кадры PNG (только холст сцены) +
// state() рядом (.json) в tmp/metro-wip/fractal-qa/qa-*.png, числа — assert'ами (+ яркость кадра: не пусто, не пересвечено).
//  00 вход по-честному: прогулка в метро → бездонный эскалатор (дверь служебного хода, спуск по дорожке, вуаль) →
//     слой станции · 01 прибытие (верх эскалатора выхода, вид вниз) · 02 атриум: вид на центр (матрёшка 18/6/2, линии,
//     ядро — яркое пятно в проекции центра) · 03 поворот гравитации зажатой W: до/середина/после + живой прогон с записью
//     кадров камеры (плавность: угол за кадр, скачок глаза) · 04 два поворота подряд → потолок (скамьи вниз головой) ·
//     05 падение с обода дыры: 3 кадра → приземление в повторе (power 2, затемнение) · 06 своя копия (seeSelf, selfSeen,
//     вырезка ×4, поза при зажатой W) · 07 эскалатор: поездка, срыв shudder/runaway/fall, копии падают одновременно ·
//     08 производительность (fps по rAF, tris, draw calls) · 09 кооп поддельными fx · 10 выход: ниша → вестибюль метро ·
//     11 вход напрямую QA-хуком (__rfFractalEnter) → 12 пауза (BlockoutViewer.setPaused: кадры стоят, звук стих, W не
//     двигает, после — без скачка).
// Свой vite (порт 5291, свой cacheDir — не мешает dev-серверам других сессий).
//   node tools/qa-fractal.mjs [--swift] [--seed=fa1] [--only=0,1,2] [--port=5291]
//   --swift — программный WebGL (без видеокарты; fps не проверяется)
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const PORT = Number(arg('port', 5291));
const SEED = arg('seed', 'fa1');
const SWIFT = process.argv.includes('--swift');
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',').map(Number)) : null;
const want = (n) => !ONLY || ONLY.has(n);
const VW = 1600, VH = 1000;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('../tmp/metro-wip/fractal-qa/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.qa.config.ts', import.meta.url)),
  root: ROOT,
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-qa-fractal', import.meta.url)),
  server: { port: PORT, strictPort: true },
  logLevel: 'warn',
});
await server.listen();
const BASE = `http://localhost:${PORT}/`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: SWIFT
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
    : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

const log = [];
const nums = {};
const ok = (name, cond, info = '') => {
  log.push({ name, ok: !!cond, info });
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};
const errors = [];
let page;
const qa = (fn, a) => page.evaluate(fn, a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n) => qa(async (n) => { for (let k = 0; k < n; k++) await new Promise((r) => requestAnimationFrame(() => r())); }, n);
const st = () => qa(() => window.__rfFractal.state());
const r2 = (v) => (Array.isArray(v) ? v.map((x) => +x.toFixed(2)) : +(+v).toFixed(2));
const canvasRect = () =>
  qa(() => {
    const b = window.__rf3d.engine.getRenderingCanvas().getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  });

/** Яркость кадра: средняя (0…255), доля почти чёрного (< 10), доля пересвета (> 245), разброс (σ). */
const lumStats = async (buf, box = null) => {
  let img = sharp(buf);
  if (box) img = img.extract(box);
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let s = 0, s2 = 0, black = 0, white = 0;
  for (let i = 0; i < data.length; i += 3) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    s += l;
    s2 += l * l;
    if (l < 10) black++;
    if (l > 245) white++;
  }
  const mean = s / n;
  return { mean: +mean.toFixed(1), sd: +Math.sqrt(Math.max(0, s2 / n - mean * mean)).toFixed(1), black: +(black / n).toFixed(3), white: +(white / n).toFixed(3) };
};
/** Снимок холста (с HUD поверх) + state() + яркость. */
const shot = async (name, { settle = 0, stateOk = true } = {}) => {
  if (settle) await sleep(settle);
  await frames(2);
  const clip = await canvasRect();
  const buf = await page.screenshot({ path: OUT + name + '.png', clip });
  const lum = await lumStats(buf);
  const s = stateOk ? await qa(() => window.__rfFractal?.state() ?? null) : null;
  writeFileSync(OUT + name + '.json', JSON.stringify({ lum, ...(s ? { ...s, hud: { ...s.hud } } : {}) }, null, 1));
  console.log(`  shot ${name} lum=${JSON.stringify(lum)}${s ? ` up=${s.up} cell=${s.cell} pos=${r2(s.pos)} ground=${s.ground} selfSeen=${s.selfSeen}` : ''}`);
  return { s, lum, buf, clip };
};
/** «Не пусто, не пересвечено»: средняя 12…150, чёрного < 85 %, пересвета < 6 %, есть детали (σ > 8). */
const sane = (tag, lum) => ok(`${tag}: кадр не пустой и не пересвеченный`, lum.mean >= 12 && lum.mean <= 150 && lum.black < 0.85 && lum.white < 0.06 && lum.sd > 8, JSON.stringify(lum));
/** advance с вводом по кускам (рендер успевает между кусками) */
const adv = async (sec, inp = {}, chunk = 0.1) => {
  for (let t = 0; t < sec - 1e-9; t += chunk) await qa(([s, i]) => window.__rfFractal?.advance(s, i), [Math.min(chunk, sec - t), inp]);
};
/** Точка мира → пиксель холста (матрица вид·проекция камеры сцены станции). */
const project = (p) =>
  qa((p) => {
    const sc = window.__rfFractalScene, cam = sc.camera, eng = sc.scene.getEngine();
    const m = cam.getTransformationMatrix().m;
    const [x, y, z] = p;
    const cx = x * m[0] + y * m[4] + z * m[8] + m[12], cy = x * m[1] + y * m[5] + z * m[9] + m[13], w = x * m[3] + y * m[7] + z * m[11] + m[15];
    if (w <= 0.01) return null;
    const W = eng.getRenderWidth(), H = eng.getRenderHeight();
    const r = eng.getRenderingCanvas().getBoundingClientRect();
    return { x: ((cx / w + 1) / 2) * r.width, y: ((1 - cy / w) / 2) * r.height, w, W, H };
  }, p);
/** Запись кадров камеры станции (ось up, глаз) — для плавности поворота. */
const recStart = () =>
  qa(() => {
    const sc = window.__rfFractalScene;
    window.__frRec = [];
    window.__frRecObs = sc.scene.onAfterRenderObservable.add(() => {
      const m = sc.camera.getWorldMatrix().m, p = sc.camera.position;
      const b = window.__rfFractal.state();
      window.__frRec.push({ t: performance.now(), up: [m[4], m[5], m[6]], fwd: [m[8], m[9], m[10]], eye: [p.x, p.y, p.z], bu: b.up, turn: b.turn ? b.turn.t : null, cell: b.cell });
    });
  });
const recStop = () =>
  qa(() => {
    window.__rfFractalScene.scene.onAfterRenderObservable.remove(window.__frRecObs);
    return window.__frRec;
  });
const ang = (a, b) => (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

/** Встать на дорожку lane текущей комнаты метро на s м от низа, лицом вниз (как tools/qa-metro-esc.mjs). */
const standOn = (lane, s) =>
  qa(
    async ({ lane, s }) => {
      const v = window.__rf3d, c = v.fps;
      const L = window.__rfMetro.lanes().find((l) => l.lane === lane);
      if (!L) return null;
      const UP = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
      const a = L.width / 2;
      const p = L.up === 'N' ? [L.x0 + a, L.y1 - s] : L.up === 'S' ? [L.x0 + a, L.y0 + s] : L.up === 'E' ? [L.x0 + s, L.y0 + a] : [L.x1 - s, L.y0 + a];
      const t = L.len / L.steps, r = (L.z1 - L.z0) / L.steps;
      const nose = Math.min(L.z1, Math.max(L.z0, L.z0 + ((s + t) * r) / t));
      c.position.set(p[0], nose + 0.06 + v.posture.eye + 0.02, -p[1]);
      const [ux, uy] = UP[L.up];
      c.rotation.set(0.2, Math.atan2(-ux, uy), 0);
      c.cameraDirection.setAll(0);
      c.cameraRotation.set(0, 0);
      await new Promise((r) => setTimeout(r, 150));
      return { lane: window.__rfMetro.state().lane, L: { dir: L.dir, len: L.len, z0: L.z0, z1: L.z1 } };
    },
    { lane, s },
  );
const metroRoom = () =>
  qa(() => {
    const S = window.__rfWalk, d = window.__rf3dFold;
    const id = d?.portal?.current ?? d?.current?.center;
    const inst = S?.rx.instances.find((i) => i.id === id);
    const link = S?.world.run().links.find((l) => l.kind === 'descent' && l.b.inst === id);
    return inst ? { id, roomId: inst.roomId, tags: inst.roomTags, floor: inst.floor ?? 0, from: link?.a.inst ?? null, metro: window.__rfMetro?.state().room ?? null, veil: getComputedStyle(document.querySelector('.v3-fr-veil')).opacity } : null;
  });
/** Шаг в нишу до выхода (слой закрылся) → комната метро. */
const walkOut = async () => {
  let exited = false;
  for (let n = 0; n < 80 && !exited; n++) {
    exited = !(await qa(() => {
      const q = window.__rfFractal;
      if (!q) return false;
      q.advance(0.1, { fwd: 1 });
      return !q.state().exited;
    }));
  }
  await page.waitForFunction(() => !window.__rfFractal, null, { timeout: 30000 }).catch(() => {});
  return exited;
};

let abyss = null;
try {
  page = await browser.newPage({ viewport: { width: VW, height: VH } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|AudioContext|autoplay/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
  for (let k = 0; ; k++) {
    try {
      await page.goto(BASE, { timeout: 180000 });
      break;
    } catch (e) {
      if (k >= 4) throw e;
      await sleep(3000);
    }
  }
  await qa((seed) => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed, deadEndChance: 0.05, branching: 1, aheadDoors: 2, clusters: true, biome: 'metro', on: true }));
    localStorage.setItem('room-forge/fractal-sound', '1');
  }, SEED);
  for (let k = 0; ; k++) {
    await page.reload({ timeout: 180000 });
    await sleep(1000);
    try {
      // бездна в 40 раз чаще (как fractalEntry.test.ts) — найти за короткий обход; без переходов по счётчику
      await qa(async () => {
        const { mutate } = await import('/src/model/store.ts');
        mutate((p) => {
          p.world.trAfter = 100000;
          const b = p.world.biomes?.find((x) => x.id === 'metro');
          if (b?.tunnels) b.tunnels.pieceWeights = { ...(b.tunnels.pieceWeights ?? {}), metro_esc_abyss: 40 };
        });
      });
      await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 60000 });
      await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rfMetro && window.__rfAbyss && window.__rfFractalEnter, null, { timeout: 120000 });
      break;
    } catch (e) {
      if (k >= 5) throw e;
      errors.length = 0;
      await sleep(8000);
    }
  }
  await page.waitForFunction(() => window.__rf3d.props.ready, null, { timeout: 120000 }).catch(() => {});
  await sleep(1500);

  // ═════════ 0 вход по-честному: бездна в мире → дверь служебного хода → спуск по дорожке ═════════
  abyss = await qa(async () => {
    const S = window.__rfWalk, w = S.world, d = window.__rf3dFold;
    const isAb = (i) => i.roomId === 'metro_esc_abyss';
    const seen = new Set();
    const q = [w.startId];
    let hit = w.run().instances.find(isAb);
    while (!hit && q.length && w.run().instances.length < 1200) {
      const id = q.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      try {
        w.expand(id);
      } catch {}
      for (const l of w.run().links) {
        if (l.kind === 'descent' || l.kind === 'lift' || l.sealed) continue;
        if (l.a.inst === id && !seen.has(l.b.inst)) q.push(l.b.inst);
        if (l.b.inst === id && !seen.has(l.a.inst)) q.push(l.a.inst);
      }
      hit = w.run().instances.find(isAb);
    }
    if (!hit) return { id: null, n: w.run().instances.length };
    for (let k = 0; k < 100 && !S.rx.instances.some((i) => i.id === hit.id); k++) await new Promise((r) => setTimeout(r, 30));
    const l = w.run().links.find((x) => !x.kind && (x.a.inst === hit.id || x.b.inst === hit.id));
    const nb = l ? (l.a.inst === hit.id ? l.b.inst : l.a.inst) : null;
    if (nb) {
      d.goTo(nb);
      await new Promise((r) => setTimeout(r, 800));
      d.placeAtDoor(hit.id, nb);
    } else d.goTo(hit.id);
    await new Promise((r) => setTimeout(r, 800));
    return { id: hit.id, nb, n: w.run().instances.length, floor: hit.floor ?? 0, cur: d.portal?.current ?? d.current.center };
  });
  ok('0 бездонный эскалатор вырос в мире, игрок в нём (через дверь служебного хода)', !!abyss.id && abyss.cur === abyss.id, JSON.stringify(abyss));
  if (!abyss.id) throw new Error('нет бездны');
  const lanes = await qa(() => window.__rfMetro.lanes().map((l) => ({ lane: l.lane, dir: l.dir, len: +l.len.toFixed(2), broken: l.broken })));
  ok('0 три дорожки вниз (−1, 0, −1), целые', lanes.length === 3 && lanes.map((l) => l.dir).join() === '-1,0,-1' && lanes.every((l) => !l.broken), JSON.stringify(lanes));
  await standOn(0, lanes[0].len - 1.5);
  await sleep(400);
  {
    const clip = await canvasRect();
    await page.screenshot({ path: OUT + 'qa-00a-abyss-top.png', clip });
  }
  // FIX 1: звук метро до входа (контекст прогулки): жест — свободная клавиша J (keydown будит MetroAudio, пока ты в метро)
  await page.keyboard.press('KeyJ');
  for (let k = 0; k < 20 && (await qa(() => window.__rfMetro?.state().audio ?? null)) !== 'running'; k++) await sleep(100);
  const metroAudio0 = await qa(() => window.__rfMetro?.state().audio ?? null);
  ok('0 звук метро в бездне играет до входа (жест)', metroAudio0 === 'running', String(metroAudio0));
  let veilMax = 0, entered = false, veilShot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const s = await qa(() => ({ a: window.__rfAbyss?.state() ?? null, fr: !!window.__rfFractal || !!document.querySelector('.v3-fr') }));
    veilMax = Math.max(veilMax, s.a?.veil ?? 0);
    if (s.a?.veil > 0.45 && s.a.veil < 0.85 && !veilShot) {
      veilShot = true;
      const clip = await canvasRect();
      await page.screenshot({ path: OUT + 'qa-00b-abyss-veil.png', clip });
    }
    if (s.fr) {
      entered = true;
      break;
    }
    await sleep(120);
  }
  nums.descentMs = Date.now() - t0;
  ok('0 спуск по дорожке: вуаль растёт до 1, вход в слой станции', veilMax >= 0.95 && entered, JSON.stringify({ veilMax, entered, ms: nums.descentMs }));
  if (!entered) throw new Error('не вошли в станцию');
  const tReady = Date.now();
  await page.waitForFunction(() => window.__rfFractal && window.__rfFractal.state().hud.ready, null, { timeout: 120000 });
  nums.readyMs = Date.now() - tReady;
  const veilIn = await qa(() => getComputedStyle(document.querySelector('.v3-fr-veil')).opacity);
  ok('0 станция собрана ≤ 8 с, вуаль снята', nums.readyMs < 8000 && veilIn === '0', JSON.stringify({ ms: nums.readyMs, veilIn }));
  // FIX 1: на станции звук метро прогулки молчит (гаснет за 0.5 с, через 1.5 с контекст спит) — не застывает
  await sleep(1800);
  {
    const m = await qa(() => window.__rfMetro.state());
    nums.metroAudioIn = { before: metroAudio0, muted: m.muted, audio: m.audio };
    ok('0 звук метро на станции заглушён (muted, контекст не играет)', m.muted === true && m.audio !== 'running', JSON.stringify(nums.metroAudioIn));
  }
  // ввод: клик по холсту — захват мыши (нужен для настоящих клавиш); без захвата — hold() QA-хука
  await page.mouse.click(VW / 2, VH / 2);
  await sleep(300);
  const locked = await qa(() => document.pointerLockElement === window.__rf3d.engine.getRenderingCanvas());
  console.log(`  захват мыши: ${locked}`);
  const cell = await qa(() => {
    const c = window.__rfFractal.cell();
    return { P: c.P, esc: c.esc.map((e) => ({ i: e.i, kind: e.kind, up: e.up, fwd: e.fwd, o: e.o, run: e.run, rise: e.rise, lanes: e.lanes.map((l) => ({ dir: l.dir, off: l.off })) })), props: c.props.length, lights: c.lights.length, spots: c.spots.length, exit: c.exit, arrival: c.arrival };
  });
  writeFileSync(OUT + 'qa-cell.json', JSON.stringify(cell, null, 1));
  const P = cell.P;
  ok('0 ячейка: P = 54, эскалаторов ≥ 5 (main ≥ 4, exit 1), пропы ≤ 400, есть световые линии', P === 54 && cell.esc.filter((e) => e.kind === 'main').length >= 4 && cell.esc.filter((e) => e.kind === 'exit').length === 1 && cell.props <= 400 && cell.lights > 0, JSON.stringify({ P, esc: cell.esc.map((e) => e.kind).join(','), props: cell.props, lights: cell.lights, spots: cell.spots }));

  // ═════════ 1 прибытие ═════════
  if (want(1)) {
    const a = await shot('qa-01a-arrival', { settle: 900 });
    ok('1 прибытие: ячейка 1,1,1, верх эскалатора выхода, на полу/ленте', a.s.cell.join() === '1,1,1' && (a.s.ground === 'floor' || a.s.ground === 'ramp'), JSON.stringify({ up: a.s.up, pos: r2(a.s.pos), ground: a.s.ground, ride: a.s.ride, exitNear: r2(a.s.exitNear ?? -1) }));
    ok('1 выходная копия близко (≤ 100 м)', a.s.exitNear !== null && a.s.exitNear <= 100, String(a.s.exitNear));
    sane('1 прибытие', a.lum);
    await qa(() => {
      const q = window.__rfFractal;
      q.advance(0);
      q.look(q.state().yaw, -0.35);
    });
    const b = await shot('qa-01b-arrival-down', { settle: 300 });
    sane('1 вид вниз по ленте', b.lum);
  }

  // ═════════ 2 атриум: вид на центр ═════════
  if (want(2)) {
    const m = P / 2;
    const views = [
      // честная стойка на полу у обода дыры нижней плиты, взгляд на центр ячейки
      { name: 'qa-02a-atrium-center', at: [m - 1, 1, P / 3 - 2.5], up: 2 },
      // по оси через дыры: висим под дырой станции 18 (QA-камера, мир стоит) — матрёшка 18 → 6 → 2
      { name: 'qa-02b-atrium-axis', at: [m + 0.4, 5, m - 6], up: 2, air: true },
      // вдоль диагонали грани — решётка повторов
      { name: 'qa-02c-atrium-diag', at: [6, 1, 6], up: 2, tgt: [m, m + 10, m] },
    ];
    for (const v of views) {
      const tgt = v.tgt ?? [m, m, m];
      const look = await qa(({ v, tgt }) => {
        const q = window.__rfFractal;
        q.place(v.at, v.up, 0);
        q.advance(0);
        const s = q.state();
        const eye = [s.pos[0], s.pos[1] + 1.6, s.pos[2]];
        const d = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]];
        const L = Math.hypot(...d);
        q.look(Math.atan2(d[0], d[2]), Math.asin(d[1] / L));
        return { eye, L };
      }, { v, tgt });
      const s = await shot(v.name, { settle: 700 });
      sane(`2 ${v.name}`, s.lum);
      if (!v.tgt) {
        // ядро ячейки (26…28)³ — в проекции центра яркое пятно (свечение), если смотрим вдоль оси сквозь дыры
        const pc = await project([m, m, m]);
        if (pc && pc.x > 8 && pc.y > 8 && pc.x < s.clip.width - 8 && pc.y < s.clip.height - 8) {
          const box = { left: Math.round(pc.x - 6), top: Math.round(pc.y - 6), width: 12, height: 12 };
          const core = await lumStats(s.buf, box);
          nums[v.name + ':core'] = core;
          if (v.air) ok('2 матрёшка: ядро в центре кадра светится (яркость пятна ≥ 150)', core.mean >= 150, JSON.stringify({ core, pc: [Math.round(pc.x), Math.round(pc.y)], L: r2(look.L) }));
          else console.log(`  ядро в кадре ${v.name}: ${JSON.stringify(core)}`);
        } else if (v.air) ok('2 матрёшка: центр ячейки в кадре', false, JSON.stringify(pc));
      }
    }
    // мерцание: мир стоит, камера стоит — два кадра через 0.5 с должны совпасть (z-fighting/мигание копий/LOD)
    {
      const clip = await canvasRect();
      await frames(3);
      const b1 = await page.screenshot({ clip });
      await sleep(500);
      const b2 = await page.screenshot({ clip });
      const [r1, r2b] = await Promise.all([b1, b2].map((b) => sharp(b).removeAlpha().raw().toBuffer()));
      let sum = 0, big = 0;
      for (let i = 0; i < r1.length; i++) {
        const d = Math.abs(r1[i] - r2b[i]);
        sum += d;
        if (d > 40) big++;
      }
      nums.flicker = { meanAbs: +(sum / r1.length).toFixed(3), bigPx: +(big / r1.length).toFixed(4) };
      ok('2 без мерцания: два кадра неподвижной сцены совпадают (средняя разница < 0.5, сильных < 0.2 %)', nums.flicker.meanAbs < 0.5 && nums.flicker.bigPx < 0.002, JSON.stringify(nums.flicker));
    }
    const stats = await qa(() => window.__rfFractal.stats());
    ok('2 световые линии и ядра нарисованы (fr:lines / fr:core в трисах)', Object.keys(stats.trisBy).some((k) => /line|light/i.test(k)) && Object.keys(stats.trisBy).some((k) => /core/i.test(k)), JSON.stringify(Object.keys(stats.trisBy)));
  }

  // ═════════ 3 поворот гравитации зажатой W ═════════
  let wall = null;
  if (want(3) || want(4)) {
    wall = await qa(() => {
      const q = window.__rfFractal, c = q.cell(), P = c.P;
      const w = (v) => ((v % P) + P) % P;
      const solid = (x, y, z) => c.vox[w(x) + P * (w(y) + P * w(z))] !== 0;
      // стойка на нижней плите (y = 1) вне дыры, стена плиты по X или Z на 6…14 м, путь свободен
      const cands = [];
      for (let x = 3; x < P - 3; x++)
        for (let z = 3; z < P - 3; z++) {
          if (!solid(x, 0, z) || solid(x, 1, z) || solid(x, 2, z)) continue;
          for (const [ax, sg, yaw] of [[0, 1, Math.PI / 2], [0, -1, -Math.PI / 2], [2, 1, 0], [2, -1, Math.PI]]) {
            let d = 1;
            for (; d < 16; d++) {
              const xx = ax === 0 ? x + sg * d : x, zz = ax === 2 ? z + sg * d : z;
              if (solid(xx, 1, zz) && solid(xx, 2, zz) && solid(xx, 3, zz)) break;
              if (solid(xx, 1, zz) || solid(xx, 2, zz) || !solid(xx, 0, zz)) {
                d = 99;
                break;
              }
            }
            // стена — сама плита (дальний воксель вплотную к границе ячейки), выше — без дыры
            const wx = ax === 0 ? x + sg * d : x, wz = ax === 2 ? z + sg * d : z;
            const slab = (ax === 0 && (wx === P - 1 || wx === 0 || wx === P)) || (ax === 2 && (wz === P - 1 || wz === 0 || wz === P));
            if (d >= 6 && d <= 14 && slab) cands.push({ at: [x + 0.5, 1, z + 0.5], yaw, d, ax, sg, score: Math.abs(x - P / 2) + Math.abs(z - P / 2) });
          }
        }
      // ближе к середине ребра (не в углу, но вне дыры): по стене вверх идти дальше
      cands.sort((a, b) => a.score - b.score);
      return cands.find((c) => (c.ax === 0 ? c.at[2] : c.at[0]) < P / 3 - 3 || (c.ax === 0 ? c.at[2] : c.at[0]) > (2 * P) / 3 + 3) ?? cands[0] ?? null;
    });
    ok('3 нашлась стена плиты в 6…14 м от стойки', !!wall, JSON.stringify(wall));
  }
  if (want(3) && wall) {
    // кадры: шаги по advance (детерминированно), «зажатая W» = fwd 1
    await qa((p) => {
      const q = window.__rfFractal;
      q.place(p.at, 2, p.yaw);
      q.look(p.yaw, 0.05);
    }, wall);
    const s0 = await shot('qa-03a-turn-before', { settle: 500 });
    sane('3 до поворота', s0.lum);
    let m = await st();
    for (let n = 0; n < 120 && !m.turn; n++) {
      await adv(0.05, { fwd: 1 }, 0.05);
      m = await st();
    }
    ok('3 упор в стену — начался поворот', !!m.turn, JSON.stringify({ push: m.push, pos: r2(m.pos) }));
    await adv(0.26, { fwd: 1 }, 0.02);
    const mid = await shot('qa-03b-turn-mid');
    await adv(0.6, { fwd: 1 }, 0.05);
    await adv(0.4, {}, 0.1);
    const aft = await shot('qa-03c-turn-after', { settle: 300 });
    ok('3 поворот: up сменился на нормаль стены, на полу', aft.s.up !== 2 && aft.s.ground === 'floor', JSON.stringify({ midT: mid.s.turn, up: aft.s.up, pos: r2(aft.s.pos) }));
    sane('3 середина поворота', mid.lum);
    sane('3 после поворота', aft.lum);

    // живой прогон: настоящая зажатая W (клавиатура при захвате мыши, иначе hold), запись каждого кадра камеры
    await qa((p) => {
      const q = window.__rfFractal;
      q.place(p.at, 2, p.yaw);
      q.look(p.yaw, 0.05);
      q.live();
    }, wall);
    await sleep(300);
    await recStart();
    if (locked) await page.keyboard.down('KeyW');
    else await qa(() => window.__rfFractal.hold(['KeyW']));
    let live = await st();
    const tl = Date.now();
    let liveShot = false;
    while (Date.now() - tl < 9000) {
      live = await st();
      if (live.turn && live.turn.t > 0.25 && !liveShot) {
        liveShot = true;
        await shot('qa-03d-turn-live-mid');
      }
      if (live.up !== 2 && !live.turn) break;
      await sleep(30);
    }
    await sleep(700);
    if (locked) await page.keyboard.up('KeyW');
    else await qa(() => window.__rfFractal.hold([]));
    const rec = await recStop();
    // плавность: угол оси up за кадр, скачок глаза за кадр, длительность поворота
    let maxDeg = 0, maxEye = 0, turnFrames = 0, sumDeg = 0, back = 0, prevDev = 0, maxRate = 0, maxEyeV = 0, hitch = 0;
    const r0 = rec.find((f) => f.turn !== null) ?? rec[0];
    const upFrom = r0.up;
    for (let i = 1; i < rec.length; i++) {
      const a = rec[i - 1], b = rec[i];
      const dg = ang(a.up, b.up);
      const de = Math.hypot(b.eye[0] - a.eye[0], b.eye[1] - a.eye[1], b.eye[2] - a.eye[2]);
      const wrap = a.cell.join() !== b.cell.join();
      if (b.turn !== null || a.turn !== null) {
        turnFrames++;
        sumDeg += dg;
        const dev = ang(upFrom, b.up);
        if (dev < prevDev - 0.5) back++;
        prevDev = dev;
      }
      maxDeg = Math.max(maxDeg, dg);
      if (!wrap) maxEye = Math.max(maxEye, de);
      // скорость (°/с, м/с) — не зависит от длинных кадров (снимок экрана посреди записи останавливает рендер)
      const dt = Math.max(1, b.t - a.t);
      if (dt > 40) hitch++;
      maxRate = Math.max(maxRate, (dg * 1000) / dt);
      if (!wrap) maxEyeV = Math.max(maxEyeV, (de * 1000) / dt);
    }
    const dtMs = rec.length > 1 ? (rec[rec.length - 1].t - rec[0].t) / (rec.length - 1) : 0;
    nums.turnLive = { frames: rec.length, frameMs: r2(dtMs), hitch, turnFrames, turnDeg: r2(sumDeg), maxDegPerFrame: r2(maxDeg), maxDegPerS: Math.round(maxRate), maxEyePerFrame: r2(maxEye), maxEyeMPerS: r2(maxEyeV), back, upAfter: live.up };
    ok('3 живой поворот (зажатая W): up сменился на 90°', live.up !== 2 && Math.abs(sumDeg - 90) < 3, JSON.stringify(nums.turnLive));
    ok('3 плавно: ≤ 450 °/с (90° за 0.55 с ≈ 164 °/с в среднем), ≥ 12 кадров на поворот, без отката', maxRate <= 450 && turnFrames >= 12 && back === 0, JSON.stringify(nums.turnLive));
    ok('3 без рывка глаза: ≤ 9 м/с (шаг 3 м/с + разворот вокруг ступней)', maxEyeV <= 9, JSON.stringify(nums.turnLive));
    await qa(() => window.__rfFractal.advance(0)); // снова ручной режим (мир стоит между шагами QA)
  }

  // ═════════ 4 два поворота подряд → потолок ═════════
  if (want(4) && wall) {
    await qa((p) => {
      const q = window.__rfFractal;
      q.place(p.at, 2, p.yaw);
      q.look(p.yaw, 0.05);
    }, wall);
    const ups = [2];
    let s = await st();
    // в стену → по стене «вверх» (бывший +Y) → в потолок; до 30 с игрового времени
    for (let n = 0; n < 300 && ups.length < 3; n++) {
      await adv(0.1, { fwd: 1 }, 0.1);
      s = await st();
      if (s.up !== ups[ups.length - 1] && !s.turn) ups.push(s.up);
    }
    const honest = s.up === 3;
    ok('4 потолок двумя поворотами зажатой W (по стене до плиты-потолка)', honest, JSON.stringify({ ups, pos: r2(s.pos), ground: s.ground }));
    if (!honest) await qa(() => window.__rfFractal.turnTo(3));
    s = await st();
    // как пришли: взгляд «вверх» — на бывший пол
    await qa((y) => window.__rfFractal.look(y, 0.85), s.yaw);
    const c0 = await shot('qa-04a-ceiling-arrived', { settle: 600 });
    ok('4 стоим на потолке (up −Y)', c0.s.up === 3 && c0.s.ground === 'floor', JSON.stringify({ pos: r2(c0.s.pos) }));
    sane('4 потолок', c0.lum);
    // по потолку к главному эскалатору бывшего пола: эскалатор с торшерами и скамьи — вниз головой над тобой
    const v = await qa(() => {
      const q = window.__rfFractal, c = q.cell(), P = c.P;
      const w = (v) => ((v % P) + P) % P;
      const solid = (x, y, z) => c.vox[w(x) + P * (w(y) + P * w(z))] !== 0;
      const m = c.esc.find((e) => e.kind === 'main' && e.up === 2);
      if (!m) return null;
      const U = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      const f = U[m.fwd];
      // цель — над серединой ленты (вне объёма эскалатора в маске взгляда)
      const tgt = [0, 1, 2].map((a) => m.o[a] + f[a] * m.run * 0.5 + (a === 1 ? m.rise * 0.5 + 2.5 : 0));
      const broken = new Set(q.state().esc.broken);
      // точка потолка (ступни на y = P − 1) в 6…22 м по горизонтали от цели, цель в прямой видимости
      let best = null;
      for (let x = 2; x < P - 2; x++)
        for (let z = 2; z < P - 2; z++) {
          if (!solid(x, P - 1, z) || solid(x, P - 2, z) || solid(x, P - 3, z)) continue;
          const d = Math.hypot(x + 0.5 - tgt[0], z + 0.5 - tgt[2]);
          if (d < 6 || d > 22) continue;
          const sc = Math.abs(d - 11);
          if (best && sc >= best.sc) continue;
          if (!window.__rfFractalScene.copies.los([x + 0.5, P - 2.6, z + 0.5], tgt, broken)) continue;
          best = { at: [x + 0.5, P - 1, z + 0.5], sc };
        }
      if (!best) return null;
      q.place(best.at, 3, 0);
      const eye = [best.at[0], best.at[1] - 1.6, best.at[2]];
      const d = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]];
      const L = Math.hypot(...d);
      // кадр up −Y: right −X, fwd +Z; pitch — к up (−Y)
      q.look(Math.atan2(-d[0], d[2]), Math.asin(-d[1] / L));
      return { at: best.at, tgt, esc: m.i, L };
    });
    if (v) {
      const c = await shot('qa-04b-ceiling-escalator', { settle: 700 });
      ok('4 с потолка видно бывший пол: эскалатор вниз головой', c.s.up === 3, JSON.stringify({ ...v, L: r2(v.L) }));
      sane('4 вид с потолка', c.lum);
    }
  }

  // ═════════ 5 падение с обода дыры → приземление в повторе ═════════
  if (want(5)) {
    await qa(() => {
      const q = window.__rfFractal, P = q.cell().P;
      q.place([P / 3 - 1.5, 1, P / 2], 2, Math.PI / 2);
      q.look(Math.PI / 2, -0.55);
    });
    const r = await shot('qa-05a-rim', { settle: 600 });
    sane('5 у обода', r.lum);
    const c0 = r.s.cell;
    await adv(0.7, { fwd: 1 }, 0.05);
    const f1 = await shot('qa-05b-fall-1');
    await adv(0.5, {}, 0.05);
    const f2 = await shot('qa-05c-fall-2');
    await adv(0.4, {}, 0.05);
    const f3 = await shot('qa-05d-fall-3');
    let s = f3.s, landed = 0, maxDark = 0;
    for (let k = 0; k < 60 && s.ground === 'air'; k++) {
      await adv(0.05, {}, 0.05);
      s = await st();
      landed = Math.max(landed, s.hud.landed);
      maxDark = Math.max(maxDark, await qa(() => +(window.__rfFractalScene.darkMat?.alpha ?? -1).toFixed(2))); // затемнение удара (в сцене)
    }
    // кадр сразу после приземления (затемнение держится 0.25 с и гаснет 0.6 с по кадрам)
    const l = await shot('qa-05e-landed');
    await adv(1.2, {}, 0.1);
    const l2 = await shot('qa-05f-after-landing', { settle: 200 });
    ok('5 падение: в воздухе 3 кадра, приземлился на пол в повторе (ячейка сменилась)', [f1, f2, f3].every((f) => f.s.ground === 'air') && l2.s.ground === 'floor' && l2.s.cell.join() !== c0.join(), JSON.stringify({ c0, c1: l2.s.cell, pos: r2(l2.s.pos), up: l2.s.up }));
    ok('5 удар power 2: hud.landed = 2, оглушение, затемнение', (landed === 2 || l.s.hud.landed === 2) && (l.s.stun > 0 || s.stun > 0) && maxDark > 0.3, JSON.stringify({ landed, hud: l.s.hud.landed, stun: r2(l.s.stun), dimOpacity: maxDark }));
    sane('5 падение', f2.lum);
    sane('5 после приземления', l2.lum);
  }

  // ═════════ 6 своя копия ═════════
  if (want(6)) {
    const found = await qa(() => window.__rfFractal.seeSelf());
    await adv(0.1, {}, 0.05);
    const a = await shot('qa-06a-see-self', { settle: 600 });
    ok('6 seeSelf: своя копия видна (selfSeen ≥ 1)', found && a.s.selfSeen >= 1, JSON.stringify({ selfSeen: a.s.selfSeen, shifts: a.s.selfShifts, pos: r2(a.s.pos), up: a.s.up }));
    sane('6 вид на копию', a.lum);
    // вырезка вокруг груди ближайшей видимой копии ×4
    const k = a.s.selfShifts?.[0];
    if (k) {
      const U = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][a.s.up];
      const chest = [0, 1, 2].map((i) => a.s.pos[i] + k[i] * P + U[i] * 1.1);
      const pc = await project(chest);
      if (pc) {
        const S = 90;
        const box = { left: Math.max(0, Math.min(a.clip.width - S, Math.round(pc.x - S / 2))), top: Math.max(0, Math.min(a.clip.height - S, Math.round(pc.y - S / 2))), width: S, height: S };
        await sharp(a.buf).extract(box).resize(S * 4, S * 4, { kernel: 'nearest' }).toFile(OUT + 'qa-06b-see-self-crop.png');
        const crop = await lumStats(a.buf, box);
        nums.selfCrop = { pc: [Math.round(pc.x), Math.round(pc.y)], dist: r2(Math.hypot(k[0] * P, k[1] * P, k[2] * P)), crop };
        ok('6 копия в кадре (проекция груди внутри холста)', pc.x > 0 && pc.y > 0 && pc.x < a.clip.width && pc.y < a.clip.height, JSON.stringify(nums.selfCrop));
      }
    }
    // крупно: узкий угол камеры — поза копии
    await qa(() => (window.__rfFractalScene.camera.fov = 0.2));
    await shot('qa-06c-see-self-zoom', { settle: 300 });
    // поза при зажатой W: живой мир, копии идут вместе с тобой
    if (locked) await page.keyboard.down('KeyW');
    else await qa(() => window.__rfFractal.hold(['KeyW']));
    await qa(() => window.__rfFractal.live());
    await sleep(320); // ~1 м: дальше край площадки — упадёшь
    const w = await shot('qa-06d-see-self-walk-zoom');
    const pose = await qa(() => {
      // веса клипов видимой копии (Idle_Standing / Walk_* …) — поза шага, а не стойка
      const h = window.__rfFractalScene.copies.self.find((x) => x.body.root.isEnabled());
      if (!h) return null;
      const wts = h.body.weights;
      return Object.fromEntries(Object.entries(wts).filter(([, v]) => v > 0.01).map(([k, v]) => [k, +v.toFixed(2)]));
    });
    if (locked) await page.keyboard.up('KeyW');
    else await qa(() => window.__rfFractal.hold([]));
    await qa(() => {
      window.__rfFractal.advance(0);
      window.__rfFractalScene.camera.fov = 1.15;
    });
    ok('6 при зажатой W копия ещё видна, идём по полу, у копии — шаг (вес стойки < 0.5)', w.s.selfSeen >= 1 && w.s.ground === 'floor' && !!pose && (pose.Idle_Standing ?? 0) < 0.5, JSON.stringify({ selfSeen: w.s.selfSeen, ground: w.s.ground, pose }));
  }

  // ═════════ 7 эскалатор: поездка и срыв ═════════
  if (want(7)) {
    const e = await qa(() => {
      const q = window.__rfFractal, c = q.cell();
      const m = c.esc.find((x) => x.kind === 'main' && x.up === 2) ?? c.esc.find((x) => x.kind === 'main');
      if (!m) return null;
      const U = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      const FR = { 0: [3, 4], 1: [2, 4], 2: [0, 4], 3: [1, 4], 4: [2, 0], 5: [3, 0] };
      const u = U[m.up], f = U[m.fwd];
      const r = [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]];
      const lane = Math.max(0, m.lanes.findIndex((l) => l.dir === 1));
      const L = m.lanes[lane];
      const at = [0, 1, 2].map((a) => m.o[a] + r[a] * L.off - f[a] * 1.5);
      const [R, F] = FR[m.up], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const yaw = Math.atan2(dot(f, U[R]), dot(f, U[F]));
      q.place(at, m.up, yaw);
      q.look(yaw, 0.12);
      return { i: m.i, up: m.up, fwd: m.fwd, at, lane, run: m.run, rise: m.rise };
    });
    ok('7 главный эскалатор найден', !!e, JSON.stringify(e));
    if (e) {
      const b = await shot('qa-07a-esc-bottom', { settle: 700 });
      sane('7 низ эскалатора', b.lum);
      await adv(1.5, { fwd: 1 }, 0.1);
      await adv(2.5, {}, 0.1);
      const r = await shot('qa-07b-esc-ride', { settle: 200 });
      ok('7 едем по эскалатору (ramp, ride)', r.s.ground === 'ramp' && !!r.s.ride && r.s.ride.esc === e.i, JSON.stringify(r.s.ride));
      ok('7 эскалатор под ногами — не кандидат фонового срыва (bgNear)', Array.isArray(r.s.bgNear) && !r.s.bgNear.includes(e.i), JSON.stringify({ ride: r.s.ride?.esc, bgNear: r.s.bgNear }));
      const p0 = r.s.pos;
      await adv(1, {}, 0.1);
      const r1 = await st();
      ok('7 лента везёт без ходьбы (≥ 0.4 м/с)', Math.hypot(r1.pos[0] - p0[0], r1.pos[1] - p0[1], r1.pos[2] - p0[2]) >= 0.4, JSON.stringify({ d: r2(Math.hypot(r1.pos[0] - p0[0], r1.pos[1] - p0[1], r1.pos[2] - p0[2])) }));
      const k = await qa(() => window.__rfFractal.forceCollapse());
      ok('7 срыв начался под игроком', k === e.i, String(k));
      const stages = [];
      await adv(0.6, {}, 0.1);
      const sh = await shot('qa-07c-shudder');
      stages.push(sh.s.esc.runs.find((x) => x.esc === k)?.stage);
      await adv(1.2, {}, 0.1);
      const ru = await shot('qa-07d-runaway');
      stages.push(ru.s.esc.runs.find((x) => x.esc === k)?.stage);
      let s = await st();
      for (let n = 0; n < 40 && s.esc.runs.find((x) => x.esc === k)?.stage !== 'fall'; n++) {
        await adv(0.1, {}, 0.1);
        s = await st();
      }
      const fa = await shot('qa-07e-fall');
      stages.push(fa.s.esc.runs.find((x) => x.esc === k)?.stage);
      ok('7 стадии срыва shudder → runaway → fall, HUD «эскалатор!»', stages.join() === 'shudder,runaway,fall' && !!sh.s.hud.alarm, JSON.stringify({ stages, alarm: [sh.s.hud.alarm, ru.s.hud.alarm, fa.s.hud.alarm] }));
      // FIX 6: срыв кончился (run удалён, broken), а конструкция ещё падает до DROP_MAX 40 м (≈ 2.86 с от начала fall)
      const escInst = (i) => qa((i) => {
        const sc = window.__rfFractalScene.scene;
        return ['fr:esc:', 'fr:escBox:'].reduce((n, p) => n + (sc.getMeshByName(p + i)?.thinInstanceCount ?? 0), 0);
      }, i);
      let tail = null, fallT = 0;
      for (let n = 0; n < 120 && (s.ground === 'air' || s.esc.runs.length || (tail && tail.after === undefined)); n++) {
        await adv(0.1, {}, 0.05);
        fallT += 0.1;
        s = await st();
        if (!tail && !s.esc.runs.some((x) => x.esc === k) && s.esc.broken.includes(k)) tail = { at: r2(fallT), inst: await escInst(k), sightVer: s.sightVer };
        else if (tail && tail.after === undefined && fallT - tail.at >= 1.5) tail.after = await escInst(k);
      }
      nums.escTail = tail;
      ok('7 сорвавшийся эскалатор падает и после конца стадии fall (виден), к DROP_MAX — спрятан', !!tail && tail.inst > 0 && tail.after === 0, JSON.stringify(tail));
      ok('7 маска взгляда копий снята по срыву (версия ≥ 1)', !!tail && tail.sightVer >= 1, JSON.stringify(tail));
      const af = await shot('qa-07f-after', { settle: 200 });
      ok('7 после срыва: эскалатор сломан, игрок жив и на полу', af.s.esc.broken.includes(k) && af.s.ground === 'floor', JSON.stringify({ esc: af.s.esc, pos: r2(af.s.pos), cell: af.s.cell }));
      // копии падают одновременно: висим в атриуме (QA-камера) там, откуда видны две копии одного эскалатора
      const v2 = await qa(() => {
        const sc = window.__rfFractalScene, q = window.__rfFractal, c = q.cell(), P = c.P;
        const broken = new Set(q.state().esc.broken);
        const U = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
        const w = (v) => ((v % P) + P) % P;
        const solid = (p) => c.vox[w(Math.floor(p[0])) + P * (w(Math.floor(p[1])) + P * w(Math.floor(p[2])))] !== 0;
        const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        let r = 777;
        const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        let best = null;
        for (const m of c.esc) {
          if (m.kind !== 'main' || broken.has(m.i)) continue;
          const u = U[m.up], f = U[m.fwd];
          const t = [0, 1, 2].map((a) => m.o[a] + f[a] * m.run * 0.5 + u[a] * (m.rise * 0.5 + 2.5));
          for (let n = 0; n < 1500; n++) {
            const eye = [2 + rnd() * (P - 4), 2 + rnd() * (P - 4), 2 + rnd() * (P - 4)];
            if (solid(eye)) continue;
            // видимые копии цели (27 ближних)
            const vis = [];
            for (let kx = -1; kx <= 1; kx++)
              for (let ky = -1; ky <= 1; ky++)
                for (let kz = -1; kz <= 1; kz++) {
                  const p = [t[0] + kx * P, t[1] + ky * P, t[2] + kz * P];
                  const d = dist(eye, p);
                  if (d < 10 || d > 90) continue;
                  if (sc.copies.los(eye, p, broken)) vis.push({ p, d, k: [kx, ky, kz] });
                }
            for (let a = 0; a < vis.length; a++)
              for (let b = a + 1; b < vis.length; b++) {
                const A = vis[a], Bv = vis[b];
                const cos = ((A.p[0] - eye[0]) * (Bv.p[0] - eye[0]) + (A.p[1] - eye[1]) * (Bv.p[1] - eye[1]) + (A.p[2] - eye[2]) * (Bv.p[2] - eye[2])) / (A.d * Bv.d);
                if (cos < Math.cos((40 * Math.PI) / 180)) continue;
                const score = A.d + Bv.d;
                if (!best || score < best.score) {
                  const [n0, n1] = A.d < Bv.d ? [A, Bv] : [Bv, A];
                  best = { i: m.i, eye, t0: n0.p, t1: n1.p, k: [n0.k, n1.k], d0: n0.d, d1: n1.d, score };
                }
              }
          }
        }
        return best;
      });
      ok('7 есть точка, откуда видны две копии одного эскалатора', !!v2, JSON.stringify(v2 && { i: v2.i, k: v2.k, d0: r2(v2.d0), d1: r2(v2.d1) }));
      if (v2) {
        // висеть: ступни под глазом, взгляд — на середину между копиями
        const hang = () =>
          qa((v) => {
            const q = window.__rfFractal;
            const tg = [(v.t0[0] + v.t1[0]) / 2, (v.t0[1] + v.t1[1]) / 2, (v.t0[2] + v.t1[2]) / 2];
            q.place([v.eye[0], v.eye[1] - 1.6, v.eye[2]], 2, 0);
            const d = [tg[0] - v.eye[0], tg[1] - v.eye[1], tg[2] - v.eye[2]];
            q.look(Math.atan2(d[0], d[2]), Math.asin(d[1] / Math.hypot(...d)));
          }, v2);
        await hang();
        const pb = [await project(v2.t0), await project(v2.t1)];
        const g = await shot('qa-07g-copies-before', { settle: 600 });
        ok('7 обе копии эскалатора в кадре', pb.every((p) => p && p.x > 0 && p.y > 0 && p.x < g.clip.width && p.y < g.clip.height), JSON.stringify(pb.map((p) => p && [Math.round(p.x), Math.round(p.y)])));
        await qa((i) => window.__rfFractal.forceCollapse(i), v2.i);
        let s2 = await st();
        for (let n = 0; n < 80 && s2.esc.runs.find((x) => x.esc === v2.i)?.stage !== 'fall'; n++) {
          await qa(() => window.__rfFractal.advance(0.1));
          await hang();
          s2 = await st();
        }
        for (let n = 0; n < 9; n++) {
          await qa(() => window.__rfFractal.advance(0.1));
          await hang();
        }
        const og = await shot('qa-07h-copies-fall');
        ok('7 второй эскалатор: срыв дошёл до fall (обе копии падают одним мешем копий)', og.s.esc.runs.some((x) => x.esc === v2.i && x.stage === 'fall'), JSON.stringify(og.s.esc.runs));
        for (let n = 0; n < 12; n++) {
          await qa(() => window.__rfFractal.advance(0.1));
          await hang();
        }
        await shot('qa-07i-copies-gone');
      }
    }
  }

  // ═════════ 8 производительность ═════════
  if (want(8)) {
    const fpsOf = () =>
      qa(async () => {
        const t0 = performance.now();
        let n = 0;
        await new Promise((r) => {
          const f = () => (++n, performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r());
          requestAnimationFrame(f);
        });
        return Math.round((n * 1000) / (performance.now() - t0));
      });
    for (const [name, at, yaw, pitch] of [['qa-08a-perf-center', [10, 1, 10], 0.78, 0.45], ['qa-08b-perf-diag', [6, 1, 6], 0.78, 0.62], ['qa-08c-perf-axis', [P / 2 + 0.4, 5, P / 2 - 6], 0, 1.4]]) {
      await qa(([at, y, p]) => {
        const q = window.__rfFractal;
        q.place(at, 2, y);
        q.look(y, p);
        q.live();
      }, [at, yaw, pitch]);
      await sleep(1200);
      const fps = await fpsOf();
      const s = await qa(() => window.__rfFractal.stats());
      await qa(() => window.__rfFractal.advance(0));
      const sh = await shot(name);
      nums[name] = { fps, tris: s.tris, drawCalls: s.drawCalls, meshes: s.meshes, thin: s.thin, props: s.props, glow: s.glow };
      // мешей с копиями — 80+ при 40 по контракту: отклонение SCENE (notes-fr-scene п. 3), держим fps и вызовы
      ok(`8 ${name}: tris ≤ 1.2 М, вызовов отрисовки ≤ 220`, s.tris <= 1.2e6 && s.drawCalls <= 220, JSON.stringify(nums[name]));
      if (!SWIFT) ok(`8 ${name}: ≥ 50 fps`, fps >= 50, JSON.stringify({ fps }));
      sane(`8 ${name}`, sh.lum);
    }
  }

  // ═════════ 9 кооп: поддельные пакеты напарника ═════════
  if (want(9)) {
    const r = await qa(() => {
      const sc = window.__rfFractalScene, q = window.__rfFractal;
      const me = q.state();
      const tag = sc.seedTag;
      const p = [me.pos[0] + 3, me.pos[1], me.pos[2] + 3];
      for (let k = 0; k < 6; k++) {
        sc.fx('peer-1', 'frPos', { s: tag, c: me.cell, p, u: me.up, y: 0.5, h: 0, v: 1.2 });
        q.advance(0.05);
      }
      const n1 = q.state().mates;
      sc.fx('peer-2', 'frPos', { s: 'zzz', c: me.cell, p, u: me.up, y: 0, h: 0, v: 0 });
      q.advance(0.05);
      const n2 = q.state().mates;
      const e = q.cell().esc.find((x) => x.kind !== 'exit' && !me.esc.broken.includes(x.i) && !q.state().esc.runs.some((r) => r.esc === x.i));
      if (e) sc.fx('peer-1', 'frEsc', { s: tag, esc: e.i, lane: 0 });
      q.advance(0.05);
      const runs = q.state().esc.runs.map((x) => x.esc);
      q.advance(2.3);
      const n3 = q.state().mates;
      return { n1, n2, runs, esc: e?.i ?? null, n3 };
    });
    ok('9 кооп (поддельные fx): напарник по frPos, чужой сид — мимо, срыв по frEsc, тишина 2 с — пропал', r.n1 === 1 && r.n2 === 1 && (r.esc === null || r.runs.includes(r.esc)) && r.n3 === 0, JSON.stringify(r));
    // дождаться конца срывов (иначе «эскалатор!» в кадре ниши)
    await qa(() => {
      const q = window.__rfFractal;
      for (let n = 0; n < 150 && q.state().esc.runs.length; n++) q.advance(0.1);
      // длинные advance() внутри одного evaluate держат getFps() < 50 → автоотключение свечения (артефакт QA, в игре
      // кадр — один шаг): вернуть, как у игрока на этой машине (90–100 fps)
      q.setGlow(true);
    });
  }

  // ═════════ 10 выход: ниша выходной копии → вестибюль метро ═════════
  if (want(10)) {
    await qa(() => window.__rfFractal.toExit());
    // вид со стороны: 9 м от ниши над эскалатором (QA-камера), арка с табличкой «Выход в город», тёплые линии и ядро
    const arch = await qa(() => {
      const q = window.__rfFractal, c = q.cell(), x = c.exit, s = q.state();
      const U = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      const FR = { 0: [3, 4], 1: [2, 4], 2: [0, 4], 3: [1, 4], 4: [2, 0], 5: [3, 0] };
      const n = U[x.facing], u = U[s.up];
      const mid = [0, 1, 2].map((i) => (x.arch.lo[i] + x.arch.hi[i]) / 2);
      const at = [0, 1, 2].map((i) => s.pos[i] + n[i] * 6);
      const eye = [0, 1, 2].map((i) => at[i] + u[i] * 1.6);
      const tgt = [0, 1, 2].map((i) => mid[i] + u[i] * 0.9);
      const d = [0, 1, 2].map((i) => tgt[i] - eye[i]);
      const L = Math.hypot(...d);
      const [R, F] = FR[s.up], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const back = { at: [...s.pos], up: s.up, yaw: s.yaw };
      q.place(at, s.up, Math.atan2(dot(d, U[R]), dot(d, U[F])));
      q.look(Math.atan2(dot(d, U[R]), dot(d, U[F])), Math.asin(dot(d, u) / L));
      return back;
    });
    const a = await shot('qa-10a-exit-arch', { settle: 800 });
    nums.glowAtExit = (await qa(() => window.__rfFractal.stats())).glow;
    sane('10 ниша издали', a.lum);
    ok('10 вид на нишу: без «эскалатор!»', !a.s.hud.alarm, String(a.s.hud.alarm));
    await qa((b) => {
      const q = window.__rfFractal;
      q.place(b.at, b.up, b.yaw);
    }, arch);
    const a2 = await shot('qa-10b-exit-close', { settle: 500 });
    ok('10 у открытой ниши выходной копии (≤ 12 м)', a2.s.exitNear !== null && a2.s.exitNear < 12, JSON.stringify({ exitNear: a2.s.exitNear, cell: a2.s.cell }));
    // ниша светится: середина кадра ярче среднего
    const mid = await lumStats(a2.buf, { left: Math.round(a2.clip.width * 0.35), top: Math.round(a2.clip.height * 0.2), width: Math.round(a2.clip.width * 0.3), height: Math.round(a2.clip.height * 0.4) });
    ok('10 ниша светится (середина кадра ярче кадра)', mid.mean > a2.lum.mean * 1.2, JSON.stringify({ mid, all: a2.lum }));
    const exited = await walkOut();
    ok('10 шаг в нишу — выход из станции', exited);
    let room = null;
    for (let k = 0; k < 40; k++) {
      await sleep(250);
      room = await metroRoom();
      if (room && room.id !== abyss.id) break;
    }
    await sleep(1500);
    {
      const clip = await canvasRect();
      const buf = await page.screenshot({ path: OUT + 'qa-10c-vestibule.png', clip });
      sane('10 вестибюль', await lumStats(buf));
    }
    ok('10 вестибюль метро этажом ниже (связь descent из бездны), вуаль 0, __rfMetro.state().room — он', !!room && room.tags.includes('вестибюль') && room.from === abyss.id && room.floor === abyss.floor - 1 && room.veil === '0' && room.metro === room.id, JSON.stringify(room));
    // FIX 1: после выхода звук метро вернулся (не заглушён; контекст играет, если играл до входа)
    const m = await qa(() => window.__rfMetro.state());
    nums.metroAudioOut = { before: metroAudio0, muted: m.muted, audio: m.audio, on: m.on };
    ok('10 звук метро после выхода вернулся', m.muted === false && (metroAudio0 !== 'running' || m.audio === 'running'), JSON.stringify(nums.metroAudioOut));
  }

  // ═════════ 11 вход напрямую QA-хуком ═════════
  if (want(11) || want(12)) {
    const t1 = Date.now();
    await qa((id) => window.__rfFractalEnter(id), abyss.id);
    // FIX 7: звук выключили, пока сцена строится (кнопка слоя) — после сборки он выключен
    await page.waitForSelector('.v3-fr .v3-loc-tools button', { timeout: 30000 });
    const toggled = await qa(() => {
      const b = document.querySelector('.v3-fr .v3-loc-tools button');
      const loading = !window.__rfFractal;
      const was = b.textContent;
      if (/вкл/.test(was)) b.click();
      return { loading, was };
    });
    await page.waitForFunction(() => window.__rfFractal && window.__rfFractal.state().hud.ready, null, { timeout: 120000 });
    {
      const snd = await qa(() => ({ hud: window.__rfFractal.state().hud.sound, btn: document.querySelector('.v3-fr .v3-loc-tools button').textContent }));
      ok('11 звук выключен во время сборки — сцена собралась без звука', toggled.loading && snd.hud === false && /выкл/.test(snd.btn), JSON.stringify({ toggled, snd }));
      // вернуть как было
      await qa(() => document.querySelector('.v3-fr .v3-loc-tools button').click());
      await sleep(100);
      const back = await qa(() => window.__rfFractal.state().hud.sound);
      ok('11 звук включён обратно кнопкой', back === true, String(back));
    }
    const s = await st();
    ok('11 вход QA-хуком: станция заново (ячейка 1,1,1, поломок нет)', s.cell.join() === '1,1,1' && s.esc.broken.length === 0, JSON.stringify({ ms: Date.now() - t1, cell: s.cell, broken: s.esc.broken }));
    await page.mouse.click(VW / 2, VH / 2);
    await sleep(300);
    const sh = await shot('qa-11-direct-arrival', { settle: 500 });
    sane('11 прибытие (хук)', sh.lum);
  }

  // ═════════ 12 пауза ═════════
  if (want(12)) {
    await qa(() => window.__rfFractal.live());
    await qa(() => window.__rfFractalScene.setSound(true));
    if (locked) await page.keyboard.down('KeyW');
    else await qa(() => window.__rfFractal.hold(['KeyW']));
    await sleep(400);
    const ctxBefore = await qa(() => ({ fr: window.__rfFractalScene.audio.ctx?.state ?? null, metro: window.__rfFractalScene.audio.metro?.ctx?.state ?? null }));
    console.log('  звук до паузы: ' + JSON.stringify(ctxBefore));
    const before = await qa(() => {
      const sc = window.__rfFractalScene;
      window.__frPauseFrames = 0;
      window.__frPauseObs = sc.scene.onAfterRenderObservable.add(() => window.__frPauseFrames++);
      window.__rf3d.setPaused(true);
      return { pos: window.__rfFractal.state().pos, audio: sc.audio.ctx?.state ?? null };
    });
    await sleep(1500);
    const during = await qa(() => ({ frames: window.__frPauseFrames, pos: window.__rfFractal.state().pos, audio: window.__rfFractalScene.audio.ctx?.state ?? null, paused: window.__rf3d.paused }));
    if (locked) await page.keyboard.up('KeyW');
    else await qa(() => window.__rfFractal.hold([]));
    const moved = Math.hypot(...during.pos.map((x, i) => x - before.pos[i]));
    ok('12 пауза: кадры стоят, W не двигает, звук стих', during.paused && during.frames <= 1 && moved < 0.01 && during.audio !== 'running', JSON.stringify({ ctxBefore, during, moved: r2(moved) }));
    ok('12 звук станции играл до паузы', ctxBefore.fr === 'running', JSON.stringify(ctxBefore));
    const after = await qa(async () => {
      const sc = window.__rfFractalScene;
      const p0 = window.__rfFractal.state().pos;
      window.__frRes = [];
      const o = sc.scene.onAfterRenderObservable.add(() => window.__frRes.push(window.__rfFractal.state().pos));
      window.__rf3d.setPaused(false);
      for (let k = 0; k < 20 && sc.audio.ctx?.state !== 'running'; k++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 200));
      sc.scene.onAfterRenderObservable.remove(o);
      sc.scene.onAfterRenderObservable.remove(window.__frPauseObs);
      const first = window.__frRes[0] ?? p0;
      return { p0, first, n: window.__frRes.length, audio: sc.audio.ctx?.state ?? null };
    });
    const jump = Math.hypot(...after.first.map((x, i) => x - after.p0[i]));
    ok('12 после паузы: кадры идут, первый кадр без скачка (≤ 0.1 м), звук вернулся', after.n >= 5 && jump <= 0.1 && after.audio === 'running', JSON.stringify({ ...after, jump: r2(jump) }));
    await shot('qa-12-after-pause', { settle: 200 });
    // выход повторно — тот же вестибюль (descend идемпотентен)
    await qa(() => window.__rfFractal.toExit());
    const ex = await walkOut();
    await sleep(1500);
    const room = await metroRoom();
    ok('12 повторный выход — тот же вестибюль', ex && !!room && room.tags.includes('вестибюль'), JSON.stringify(room));
  }
} catch (e) {
  errors.push('SCRIPT ' + (e?.stack ?? e));
} finally {
  ok('нет ошибок страницы', !errors.length, errors.slice(0, 8).join(' | '));
  writeFileSync(OUT + 'qa-fractal-log.json', JSON.stringify({ seed: SEED, swift: SWIFT, nums, log, errors }, null, 1));
  console.log('NUMS ' + JSON.stringify(nums));
  await browser.close();
  await server.close();
  process.exit(log.some((r) => !r.ok) ? 1 : 0);
}
