// QA «Прогулки» по метро глазами (docs/GENERATOR-4D.md §24, docs/LOCATIONS.md §18): снимки каждого вида комнат и
// эскалатора для придирчивого осмотра + числа assert'ами.
//  01 вестибюль (старт) · 02 зал вдоль оси (бесконечная перспектива, высокий потолок, пилоны, пол, панно, пути, туман) ·
//  03 пересадочный крест · 04 переход · 05 станция поменьше · 06 крошечная станция · 07/08 эскалатор снизу/сверху ·
//  09 поездка (позиция меняется) · 10 срыв: рывок · 11 срыв: лента бежит вниз · 12 падение · 13 «Эскалатор сорвался» ·
//  14 «Ещё раз» · 15 сломанная дорожка после пересборки (обломки, перила у края) · 16 сгоревший зал.
// Экземпляры нужного вида ищет, выращивая мир (__rfWalk.world.expand), и ставит камеру (__rf3dFold.goTo + позиция).
// Свой vite (порт 5287, свой cacheDir — не мешает dev-серверам других сессий). Скриншоты — tmp/metro-wip/shots/*.png.
//   node tools/qa-metro-walk.mjs            QA_ONLY=hall,esc — только эти части (vest, hall, cross, per, mini, micro, esc, ride, crash, burnt)
//   QA_SEED=qa-metro-2 — другой сид
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5287;
const SEED = process.env.QA_SEED || 'qa-metro-walk';
const ONLY = (process.env.QA_ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const VW = Number(process.env.QA_W) || 1600, VH = Number(process.env.QA_H) || 1000;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('../tmp/metro-wip/shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.qa.config.ts', import.meta.url)),
  root: ROOT,
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-qa-metro', import.meta.url)),
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
/** Снимок холста сцены (с панелями поверх него). */
const shot = async (page, name) => {
  await frames(page, 2);
  const r = await page.evaluate(() => {
    const b = window.__rf3d.scene.getEngine().getRenderingCanvas().getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  await page.screenshot({ path: out + name + '.png', clip: r });
  console.log('  shot', 'tmp/metro-wip/shots/' + name + '.png');
};
const st = (page) => page.evaluate(() => window.__rfMetro.state());
const waitSt = async (page, fn, ms) => {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < ms) {
    s = await st(page);
    if (fn(s)) return s;
    await page.waitForTimeout(120);
  }
  return s;
};

/**
 * Вырастить мир (обход в ширину от старта), пока не найдётся экземпляр, подходящий под pred (тело функции от i —
 * RunInstance; rank — тело функции от i, чем больше, тем лучше, выбирается лучший после роста до minN комнат).
 * → сводка экземпляра в метрах: bbox, z, метки (середина, сторона, метка, связь).
 */
const find = (page, pred, { rank = '0', minN = 0, maxN = 1400 } = {}) =>
  page.evaluate(
    async ({ pred, rank, minN, maxN }) => {
      const S = window.__rfWalk, w = S.world;
      const P = new Function('i', 'return ' + pred), R = new Function('i', 'rx', 'return ' + rank);
      const seen = new Set();
      const q = [w.startId];
      const enough = () => w.run().instances.length >= minN && w.run().instances.some(P);
      while (!enough() && q.length && w.run().instances.length < maxN) {
        const id = q.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        w.expand(id);
        for (const l of w.run().links) {
          if (l.kind === 'descent' || l.kind === 'lift' || l.sealed) continue;
          if (l.a.inst === id && !seen.has(l.b.inst)) q.push(l.b.inst);
          if (l.b.inst === id && !seen.has(l.a.inst)) q.push(l.a.inst);
        }
      }
      for (let k = 0; k < 40 && !S.rx.instances.some(P); k++) await new Promise((r) => setTimeout(r, 100));
      const xs = S.rx.instances.filter(P);
      if (!xs.length) return { n: S.rx.instances.length, hit: null };
      const rx = S.rx;
      xs.sort((a, b) => R(b, rx) - R(a, rx));
      const i = xs[0], c = rx.cellM || 0.1;
      return {
        n: rx.instances.length,
        count: xs.length,
        hit: {
          id: i.id, roomId: i.roomId, tags: i.roomTags, z: i.z ?? 0, ceilM: i.ceilM ?? null, rot: i.rot, rank: R(i, rx),
          bbox: [i.bbox.x0 * c, i.bbox.y0 * c, i.bbox.x1 * c, i.bbox.y1 * c],
          conns: i.connectors.map((k) => ({
            tag: k.tag, side: k.side, len: k.len * c, to: k.linkedTo?.inst ?? null,
            mx: ((k.line[0] + k.line[2]) / 2) * c, my: ((k.line[1] + k.line[3]) / 2) * c,
          })),
        },
      };
    },
    { pred, rank, minN, maxN },
  );

/** Встать в экземпляре inst в точке плана (x, y) м, лицом к (tx, ty), наклон pitch (рад, + — вниз). */
const standAt = (page, inst, x, y, tx, ty, pitch = 0) =>
  page.evaluate(
    async ({ inst, x, y, tx, ty, pitch }) => {
      const d = window.__rf3dFold, v = window.__rf3d;
      const cur = () => d.portal?.current ?? d.current.center;
      if (cur() !== inst.id) {
        d.goTo(inst.id);
        await new Promise((r) => setTimeout(r, 900));
      }
      const c = v.fps;
      c.position.set(x, inst.z + v.posture.eye + 0.05, -y);
      c.rotation.set(pitch, Math.atan2(tx - x, -(ty - y)), 0);
      c.cameraDirection.setAll(0);
      c.cameraRotation.set(0, 0);
      await new Promise((r) => setTimeout(r, 200));
      return { cur: cur(), x: c.position.x, y: -c.position.z, h: c.position.y };
    },
    { inst, x, y, tx, ty, pitch },
  );
/** Дождаться, пока куски вокруг достроятся (модели предметов, соседние части портала). */
const settle = async (page, ms = 2500) => {
  await page.waitForFunction(() => window.__rf3d.props.ready, null, { timeout: 60000 });
  await page.waitForTimeout(ms);
};
/** Середины двух торцов куска с меткой tag (вдоль оси); нет двух — середины противоположных сторон bbox. */
const axisOf = (h, tag) => {
  const ks = h.conns.filter((k) => k.tag === tag);
  const opp = { N: 'S', S: 'N', E: 'W', W: 'E' };
  for (const a of ks) {
    const b = ks.find((k) => k.side === opp[a.side]);
    if (b) return [a, b];
  }
  const [x0, y0, x1, y1] = h.bbox;
  return x1 - x0 > y1 - y0 ? [{ mx: x0, my: (y0 + y1) / 2 }, { mx: x1, my: (y0 + y1) / 2 }] : [{ mx: (x0 + x1) / 2, my: y0 }, { mx: (x0 + x1) / 2, my: y1 }];
};
/** Встать у торца a куска (in м внутрь, сдвиг side м поперёк), лицом к торцу b. */
const alongAxis = async (page, h, a, b, inM = 0.6, side = 0, pitch = 0) => {
  const L = Math.hypot(b.mx - a.mx, b.my - a.my), ux = (b.mx - a.mx) / L, uy = (b.my - a.my) / L;
  const x = a.mx + ux * inM - uy * side, y = a.my + uy * inM + ux * side;
  return standAt(page, h, x, y, x + ux * 10, y + uy * 10, pitch);
};

/** Встать на дорожку lane тоннеля на s м от низа (посередине поперёк), лицом вверх (или вниз). */
const standOn = (page, lane, s, faceDown = false, pitch = 0.12) =>
  page.evaluate(
    async ({ lane, s, faceDown, pitch }) => {
      const v = window.__rf3d, c = v.fps;
      const L = window.__rfMetro.lanes().find((l) => l.lane === lane);
      const UP = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
      const a = L.width / 2;
      const p = L.up === 'N' ? [L.x0 + a, L.y1 - s] : L.up === 'S' ? [L.x0 + a, L.y0 + s] : L.up === 'E' ? [L.x0 + s, L.y0 + a] : [L.x1 - s, L.y0 + a];
      const t = L.len / L.steps, r = (L.z1 - L.z0) / L.steps;
      const nose = Math.min(L.z1, Math.max(L.z0, L.z0 + ((s + t) * r) / t));
      c.position.set(p[0], nose + 0.06 + v.posture.eye + 0.02, -p[1]);
      const [ux, uy] = UP[L.up];
      c.rotation.set(pitch, Math.atan2(faceDown ? -ux : ux, faceDown ? uy : -uy), 0);
      c.cameraDirection.setAll(0);
      c.cameraRotation.set(0, 0);
      await new Promise((r) => setTimeout(r, 120));
      return window.__rfMetro.state().lane;
    },
    { lane, s, faceDown, pitch },
  );
const goInst = (page, id) =>
  page.evaluate(async (id) => {
    const d = window.__rf3dFold;
    if ((d.portal?.current ?? d.current.center) !== id) d.goTo(id);
    await new Promise((r) => setTimeout(r, 900));
    return d.portal?.current ?? d.current.center;
  }, id);
/** Средняя яркость холста 0…255 и доля почти чёрных пикселей (по уменьшенной копии в странице). */
const luma = (page) =>
  page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => r()));
    const src = window.__rf3d.scene.getEngine().getRenderingCanvas();
    const cv = document.createElement('canvas');
    cv.width = 160;
    cv.height = 100;
    const g = cv.getContext('2d');
    window.__rf3d.scene.render();
    g.drawImage(src, 0, 0, 160, 100);
    const d = g.getImageData(0, 0, 160, 100).data;
    let s = 0, dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      s += l;
      if (l < 8) dark++;
    }
    return { mean: Math.round(s / (d.length / 4)), dark: +(dark / (d.length / 4)).toFixed(3) };
  });

let bad = 0;
try {
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
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
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem('room-forge/walk', JSON.stringify({ seed, deadEndChance: 0.05, branching: 1, aheadDoors: 2, clusters: true, biome: 'metro', on: true }));
    localStorage.setItem('room-forge/metro-sound', '0');
  }, SEED);
  for (let k = 0; ; k++) {
    await page.reload({ timeout: 180000 });
    await sleep(1000);
    try {
      await page.evaluate(async () => {
        const { mutate } = await import('/src/model/store.ts');
        mutate((p) => Object.assign(p.world, { trAfter: 100000 }));
      });
      await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 60000 });
      await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive && window.__rfMetro, null, { timeout: 120000 });
      break;
    } catch (e) {
      if (k >= 5) throw e;
      errors.length = 0;
      await sleep(8000);
    }
  }
  await settle(page, 2000);
  // подсказка-абзац метро закрывает пол-кадра — для осмотра прячем (сами панели смерти/подсказки E не трогаем)
  await page.addStyleTag({ content: '.v3-obsh-hint{display:none!important}' });

  // ═════════════════ 01 вестибюль ═════════════════
  const s0 = await waitSt(page, (s) => s.on, 15000);
  const env = await page.evaluate(() => {
    const sc = window.__rf3d.scene, S = window.__rfWalk;
    const inst = S.rx.instances.find((i) => i.id === window.__rfMetro.state().room);
    const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    return { fog: [sc.fogMode, sc.fogStart, sc.fogEnd], fogColor: hex(sc.fogColor), clear: hex(sc.clearColor), room: inst?.roomId, tags: inst?.roomTags, id: inst?.id };
  });
  ok('старт в метро: вестибюль, режим метро, туман', s0?.on && env.tags?.includes('вестибюль') && env.fog[0] === 3, JSON.stringify(env));
  if (want('vest')) {
    const v = await find(page, `i.id === ${JSON.stringify(env.id)}`);
    const h = v.hit;
    const [x0, y0, x1, y1] = h.bbox;
    // из угла на диагональ — турникеты, кассы, будка, двери выхода
    await standAt(page, h, x0 + 1.2, y0 + 1.2, (x0 + x1) / 2 + 1, (y0 + y1) / 2 + 1, 0.05);
    await settle(page, 1500);
    await shot(page, '01-vestibule');
    await standAt(page, h, x1 - 1.2, y1 - 1.2, (x0 + x1) / 2, (y0 + y1) / 2, 0.05);
    await settle(page, 1200);
    await shot(page, '01b-vestibule');
  }

  // ═════════════════ 02 зал вдоль оси ═════════════════
  if (want('hall')) {
    // пролёт зала, за которым по оси — ещё залы (длинная перспектива)
    const rank = `(() => { const ks = i.connectors.filter((k) => k.tag === 'metro_hall'); let best = 0;
      for (const k0 of ks) { let n = 0, cur = i, k = k0;
        while (k && k.linkedTo && n < 12) { const nx = rx.instances.find((x) => x.id === k.linkedTo.inst); if (!nx || !nx.roomId.startsWith('metro_hall')) break; n++;
          const back = k.linkedTo.connector; const ks2 = nx.connectors.filter((q) => q.tag === 'metro_hall' && q.id !== back); k = ks2.length === 1 ? ks2[0] : null; cur = nx; }
        best = Math.max(best, n); }
      return best; })()`;
    const r = await find(page, `i.roomId === 'metro_hall_9'`, { rank, minN: 260 });
    ok('зал: пролёт metro_hall_9 найден', !!r.hit, JSON.stringify({ n: r.n, count: r.count, rank: r.hit?.rank, ceil: r.hit?.ceilM }));
    if (r.hit) {
      const h = r.hit;
      let [a, b] = axisOf(h, 'metro_hall');
      // смотреть туда, где цепочка залов длиннее (её считали по любой стороне — проверим обе)
      const ch = await page.evaluate(({ id, a, b }) => {
        const rx = window.__rfWalk.rx, i = rx.instances.find((x) => x.id === id);
        const run = (k) => { let n = 0; while (k && k.linkedTo && n < 12) { const nx = rx.instances.find((x) => x.id === k.linkedTo.inst); if (!nx || !nx.roomId.startsWith('metro_hall')) break; n++; const ks2 = nx.connectors.filter((q) => q.tag === 'metro_hall' && q.id !== k.linkedTo.connector); k = ks2.length === 1 ? ks2[0] : null; } return n; };
        const ks = i.connectors.filter((k) => k.tag === 'metro_hall');
        return ks.map((k) => ({ side: k.side, n: run(k) }));
      }, { id: h.id, a, b });
      const fwd = ch.find((k) => k.side === b.side)?.n ?? 0, back = ch.find((k) => k.side === a.side)?.n ?? 0;
      if (back > fwd) [a, b] = [b, a];
      await alongAxis(page, h, a, b, 0.5, 0, -0.06);
      await settle(page, 3000);
      await shot(page, '02-hall');
      const L = await luma(page);
      ok('зал: кадр не чёрный и не пересвечен', L.mean > 35 && L.mean < 215, JSON.stringify({ ...L, chain: ch }));
      // взгляд вверх — потолок высокий (4.5 м)
      await alongAxis(page, h, a, b, 0.5, -3.6, -0.32);
      await settle(page, 1200);
      await shot(page, '02b-hall-up');
      // поперёк зала: пилоны, путь, путевая стена с панно
      const [x0, y0, x1, y1] = h.bbox;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const axX = Math.abs(b.mx - a.mx) > Math.abs(b.my - a.my);
      if (axX) await standAt(page, h, cx, cy, cx, y0, 0.02);
      else await standAt(page, h, cx, cy, x0, cy, 0.02);
      await settle(page, 1200);
      await shot(page, '02c-hall-side');
    }
  }

  // ═════════════════ 03 пересадочный крест ═════════════════
  if (want('cross')) {
    const r = await find(page, `i.roomId === 'metro_hall_x' || i.roomId === 'metro_hall_T'`, { rank: `i.roomId === 'metro_hall_x' ? 1 : 0`, minN: 300 });
    ok('крест/тройник зала найден', !!r.hit, JSON.stringify({ n: r.n, room: r.hit?.roomId }));
    if (r.hit) {
      const [x0, y0, x1, y1] = r.hit.bbox;
      await standAt(page, r.hit, x0 + 2.2, y0 + 2.2, x1 - 3, y1 - 3, -0.03);
      await settle(page, 2500);
      await shot(page, '03-hall-cross');
    }
  }

  // ═════════════════ 04 переход ═════════════════
  if (want('per')) {
    const r = await find(page, `i.roomId === 'metro_per_9'`);
    ok('переход metro_per_9 найден', !!r.hit, JSON.stringify({ n: r.n }));
    if (r.hit) {
      const [a, b] = axisOf(r.hit, 'metro_per');
      await alongAxis(page, r.hit, a, b, 0.5, 0, 0.02);
      await settle(page, 2000);
      await shot(page, '04-passage');
    }
  }

  // ═════════════════ 05 станция поменьше ═════════════════
  if (want('mini')) {
    const r = await find(page, `i.roomId === 'metro_mini_9'`);
    ok('станция поменьше metro_mini_9 найдена', !!r.hit, JSON.stringify({ n: r.n }));
    if (r.hit) {
      const [a, b] = axisOf(r.hit, 'metro_per');
      await alongAxis(page, r.hit, a, b, 0.5, 0, 0.0);
      await settle(page, 2000);
      await shot(page, '05-mini-station');
    }
  }

  // ═════════════════ 06 крошечная станция ═════════════════
  if (want('micro')) {
    const r = await find(page, `i.roomId === 'metro_micro_9'`);
    ok('крошечная станция metro_micro_9 найдена', !!r.hit, JSON.stringify({ n: r.n }));
    if (r.hit) {
      const [a, b] = axisOf(r.hit, 'metro_slu');
      await alongAxis(page, r.hit, a, b, 0.4, 0, 0.04);
      await settle(page, 2000);
      await shot(page, '06-micro-station');
    }
  }

  // ═════════════════ 07–09 эскалатор ═════════════════
  let tun = null, lanes = [];
  if (want('esc') || want('ride') || want('crash')) {
    const r = await find(page, `i.roomId.startsWith('metro_esc_tunnel') && !(i.escBroken ?? []).length`, { rank: `i.roomId === 'metro_esc_tunnel' ? 1 : 0`, minN: 200 });
    tun = r.hit;
    ok('эскалаторный тоннель найден', !!tun, JSON.stringify({ n: r.n, room: tun?.roomId }));
    if (tun) {
      await goInst(page, tun.id);
      await page.evaluate(() => window.__rfMetro.noGrace());
      lanes = await page.evaluate(() => window.__rfMetro.lanes());
      ok('эскалатор: три дорожки', lanes.length === 3, JSON.stringify(lanes.map((l) => [l.lane, l.dir, l.up, +l.len.toFixed(2)])));
    }
  }
  if (tun && want('esc')) {
    await standOn(page, lanes[1].lane, -2.2, false, -0.08);
    await settle(page, 2500);
    await shot(page, '07-escalator-bottom');
    await standOn(page, lanes[1].lane, lanes[1].len + 1.8, true, 0.22);
    await settle(page, 2000);
    await shot(page, '08-escalator-top');
  }
  if (tun && want('ride')) {
    const upL = lanes.find((l) => l.dir === 1) ?? lanes[0];
    await standOn(page, upL.lane, 2.0, false, 0.05);
    await sleep(400);
    const a = (await st(page)).lane;
    await sleep(3000);
    const b = (await st(page)).lane;
    await shot(page, '09-escalator-ride');
    ok('поездка: лента везёт вверх (s растёт, ноги на ступени)', a && b && b.s - a.s > 0.4 && Math.abs(b.feet - b.nose - 0.06) < 0.3, JSON.stringify({ a, b }));
  }

  // ═════════════════ 10–15 срыв ═════════════════
  if (tun && want('crash')) {
    await goInst(page, tun.id);
    await page.evaluate(() => window.__rfMetro.noGrace());
    const L = lanes.find((l) => l.dir === -1) ?? lanes[lanes.length - 1];
    await standOn(page, L.lane, L.len - 1.0, true, 0.25);
    await sleep(300);
    const key = await page.evaluate((n) => window.__rfMetro.forceCollapse(n), L.lane);
    ok('срыв начался под игроком', !!key, String(key));
    const s1 = await waitSt(page, (s) => s.runs.some((r) => r.key === key && r.stage === 'shudder' && r.t > 0.25), 8000);
    await shot(page, '10-collapse-shudder');
    ok('срыв: стадия рывка', s1?.runs.some((r) => r.key === key && r.stage === 'shudder'), JSON.stringify(s1?.runs));
    const s2 = await waitSt(page, (s) => s.runs.some((r) => r.key === key && r.stage === 'runaway' && r.t > 0.6), 15000);
    await shot(page, '11-collapse-runaway');
    ok('срыв: лента бежит вниз (runaway, лента разгоняется)', s2?.runs.some((r) => r.key === key && r.stage === 'runaway' && Math.abs(r.belt ?? r.v ?? 0) > 0), JSON.stringify(s2?.runs));
    // не дать донести до низа: во второй половине разгона — снова к верху бегущей ленты
    await waitSt(page, (s) => s.runs.some((r) => r.key === key && r.stage === 'runaway' && r.t >= 2.4) || s.falling, 10000);
    const s3a = await st(page);
    if (!s3a.falling && !s3a.dead) await standOn(page, L.lane, L.len - 0.5, true, 0.3);
    const s3 = await waitSt(page, (s) => s.falling || s.dead, 20000);
    await sleep(350);
    await shot(page, '12-fall');
    ok('падение с лентой', s3 && (s3.falling || s3.dead), JSON.stringify({ falling: s3?.falling, dead: s3?.dead }));
    const s4 = await waitSt(page, (s) => s.dead, 20000);
    await sleep(700);
    const panel = await page.evaluate(() => document.querySelector('.v3-obsh-dead h2')?.textContent ?? null);
    await shot(page, '13-dead');
    ok('смерть: панель «Эскалатор сорвался»', s4?.dead && panel === 'Эскалатор сорвался', String(panel));
    const broken = await page.waitForFunction((k) => {
      const [id, lane] = k.split('/');
      return (window.__rfWalk.rx.instances.find((x) => x.id === id)?.escBroken ?? []).includes(+lane);
    }, key, { timeout: 40000 }).then(() => true, () => false);
    ok('дорожка сломана в мире (escBroken у экземпляра)', broken, key);
    await page.evaluate(() => window.__rfWalk.saveNow());
    const saved = await page.evaluate(() => {
      const S = window.__rfWalk;
      const j = JSON.parse(localStorage.getItem(S.key) || '{}');
      const esc = j.esc ?? j.world?.esc ?? null;
      return { esc, keys: Object.keys(j).slice(0, 20) };
    });
    ok('сохранение: world.esc содержит сломанную дорожку', Array.isArray(saved.esc) && saved.esc.includes(key), JSON.stringify(saved));
    await page.evaluate(() => window.__rfMetro.retry());
    await sleep(1500);
    const rs = await st(page);
    const tags = await page.evaluate((room) => window.__rfWalk.rx.instances.find((i) => i.id === room)?.roomTags ?? null, rs.room);
    ok('«Ещё раз» — в зале или вестибюле метро, жив', !rs.dead && tags && tags[0] === 'метро' && tags.includes('зал') && !tags.includes('эскалатор'), JSON.stringify({ room: rs.room, tags }));
    await settle(page, 1500);
    await shot(page, '14-respawn');

    // после пересборки: обломки на дне, перила у края верхней площадки
    await goInst(page, tun.id);
    const after = await page.evaluate((id) => {
      const i = window.__rfWalk.rx.instances.find((x) => x.id === id);
      return { flights: i.stair.flights.length, escLanes: i.escLanes?.length, broken: i.escBroken };
    }, tun.id);
    ok('пересборка: марш сломанной убран, escLanes — все три', after.flights === 2 && after.escLanes === 3, JSON.stringify(after));
    await standOn(page, L.lane, -2.4, false, -0.06);
    await settle(page, 2500);
    await shot(page, '15-broken-lane');
    await standOn(page, L.lane, L.len + 1.2, true, 0.45);
    await settle(page, 1500);
    await shot(page, '15b-broken-lane-top');
  }

  // ═════════════════ 16 сгоревший зал ═════════════════
  if (want('burnt')) {
    const r = await find(page, `i.roomId === 'metro_burnt_hall'`, { maxN: 2200 });
    ok('сгоревший зал найден', !!r.hit, JSON.stringify({ n: r.n }));
    if (r.hit) {
      const h = r.hit;
      const [x0, y0, x1, y1] = h.bbox;
      const esc = h.conns.find((k) => k.tag === 'hall>esc') ?? { mx: (x0 + x1) / 2, my: y0 };
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      // от противоположной стены — к остову эскалатора
      const fx = cx + (cx - esc.mx) * 0.8, fy = cy + (cy - esc.my) * 0.8;
      await standAt(page, h, fx, fy, esc.mx, esc.my, 0.06);
      await settle(page, 2500);
      await shot(page, '16-burnt-hall');
    }
  }
  ok('нет ошибок страницы', !errors.length, errors.slice(0, 5).join(' | '));
} catch (e) {
  console.error(e);
  bad++;
} finally {
  await browser.close();
  await server.close();
}
bad += results.filter((r) => !r.ok).length;
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(bad ? 1 : 0);
