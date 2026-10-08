// QA коопа «Прогулки» (docs/COOP.md): playwright + системный Chrome, свой vite (порт 5241, relay на /coop) — без HMR и
// слежения за файлами: в дереве параллельно работают другие сессии, их правки не должны перемонтировать страницу посреди
// прогона.
// Два игрока — два контекста браузера (разные вкладки-игроки):
//  1. A: «3D» → «Подключить онлайн» → «Создать лобби» → код (UUID); B: «Подключить онлайн» → код → «Подключиться».
//  2. Миры одинаковы (seq, отпечаток); B появляется рядом с A.
//  3. Видят друг друга: аватар в кадре (пиксель в центре экрана — цвета другого игрока), на скриншотах.
//  4. Рядом — на 75% медленнее (сдвиг за кадр ×0.25), у обоих; далеко — как обычно.
//  5. Дверь: A открывает выход (E) — у B та же дверь открыта (анимация, связь, флаг opened), миры совпали; и наоборот.
//  6. Сквозь проём: A в комнате за дверью — B видит его через проём.
//  6б. Снег: B ползком — аватар лежит (не под полом); B засыпан — A откапывает (E, digMate нажатий).
//  7. B перезагрузил вкладку — вернулся в лобби на своё место, мир тот же. B вышел — у A аватар пропал.
// Скриншоты — tools/qa/coop-*.png. node tools/qa-coop.mjs [--keep-server]
import { chromium } from 'playwright-core';
import { createServer as createVite } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const PORT = 5241;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const keep = process.argv.includes('--keep-server');
// vite в этом же процессе (relay лобби — его плагин из vite.config.ts); порт занят — strictPort падает сразу
let serverLog = '';
const vite = await createVite({
  root: ROOT,
  server: { port: PORT, strictPort: true, hmr: false, watch: null },
  customLogger: {
    info: (m) => (serverLog += m + '\n'),
    warn: (m) => (serverLog += m + '\n'),
    warnOnce: (m) => (serverLog += m + '\n'),
    error: (m) => (serverLog += m + '\n'),
    clearScreen() {},
    hasErrorLogged: () => false,
    hasWarned: false,
  },
});
await vite.listen();
const stopServer = async () => {
  if (!keep) await vite.close();
};
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

const COLORS = { A: '#e0563f', B: '#4fb3e8' };
const loads = {};

/** Игрок: свой контекст (свои localStorage/sessionStorage), «3D» → «Прогулка» сида qa-coop. */
async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} PAGEERROR ${e.message}`));
  // перезагрузки страницы (Vite пересобрал зависимости и перезагрузил её сам) — для разбора нестабильных прогонов
  page.on('load', () => (loads[name] = (loads[name] ?? 0) + 1));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|WebSocket/i.test(m.text()) && errors.push(`${name} ${m.text().slice(0, 300)}`));
  await go(page, BASE);
  await page.evaluate(
    ({ name, color }) => {
      localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-coop', deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, on: true }));
      localStorage.setItem('room-forge/coop/profile', JSON.stringify({ name, color, server: '', lastLobby: '' }));
    },
    { name, color: COLORS[name] },
  );
  await page.reload({ timeout: 180000 });
  await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 180000 });
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
  return page;
}

const coopOnline = (page) => page.waitForFunction(() => window.__rfCoop?.co?.status === 'online' && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });

/** Где игрок: комната, камера, seq и отпечаток мира. */
const state = (page) =>
  page.evaluate(() => {
    const d = window.__rf3dFold, c = window.__rf3d.fps, co = window.__rfCoop?.co;
    return {
      room: d.portal?.current ?? d.current.center,
      pos: [c.position.x, c.position.y, c.position.z],
      seq: co?.lastSeq ?? null,
      fp: co?.walk?.fingerprint() ?? null,
      players: co ? [...co.players.values()].map((p) => p.name) : [],
      shown: window.__rfCoop?.presence?.shown.map((a) => a.id) ?? [],
      slowed: window.__rfCoop?.presence?.slowed ?? null,
    };
  });

/** Поставить камеру: позиция (Babylon) и взгляд на точку. */
const place = (page, x, z, lookX, lookZ) =>
  page.evaluate(
    ({ x, z, lookX, lookZ }) => {
      const c = window.__rf3d.fps;
      c.position.set(x, c.position.y, z);
      c.rotation.set(0.04, Math.atan2(lookX - x, lookZ - z), 0);
      c.cameraDirection.setAll(0);
      c.cameraRotation.set(0, 0);
    },
    { x, z, lookX, lookZ },
  );

/** Самый длинный прямоугольник пола текущей комнаты (план x, y↓) — место для двоих. */
const floorRect = (page) =>
  page.evaluate(() => {
    const d = window.__rf3dFold;
    const room = d.portal?.current ?? d.current.center;
    const piece = d.portal.cache.peek(room);
    let best = null;
    for (const r of piece?.floor ?? []) {
      const len = Math.max(r.x1 - r.x0, r.y1 - r.y0);
      if (!best || len > best.len) best = { ...r, len };
    }
    return { room, rect: best };
  });

/** Сдвиг камеры за n кадров при шаге step м/кадр вдоль (dx, dz) — как от клавиш (cameraDirection каждый кадр). */
const walkFrames = (page, dx, dz, n = 30, step = 0.02) =>
  page.evaluate(
    async ({ dx, dz, n, step }) => {
      const c = window.__rf3d.fps;
      const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      await frame();
      const x0 = c.position.x, z0 = c.position.z;
      for (let k = 0; k < n; k++) {
        c.cameraDirection.set(dx * step, 0, dz * step);
        await frame();
      }
      c.cameraDirection.setAll(0);
      await frame();
      return Math.hypot(c.position.x - x0, c.position.z - z0);
    },
    { dx, dz, n, step },
  );

/** Средний цвет квадрата в центре скриншота. */
async function centerColor(page, file) {
  const png = await page.locator('canvas').first().screenshot({ path: file });
  const img = sharp(png);
  const { width, height } = await img.metadata();
  const s = 24;
  const { data } = await img.extract({ left: Math.round(width / 2 - s / 2), top: Math.round(height / 2 - s / 2), width: s, height: s }).raw().toBuffer({ resolveWithObject: true });
  const ch = data.length / (s * s);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += ch) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const n = s * s;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
const bluish = ([r, g, b]) => b > r + 25 && b > 60;
const reddish = ([r, g, b]) => r > b + 25 && r > g + 10 && r > 60;

const until = async (page, fn, arg, ms = 20000) => {
  await page.waitForFunction(fn, arg, { timeout: ms });
};
/** Дождаться, пока у A и B применено одинаковое число операций мира (до 20 с). */
async function sameSeq(A, B) {
  for (let k = 0; k < 80; k++) {
    const [a, b] = await Promise.all([A.evaluate(() => window.__rfCoop?.co?.lastSeq), B.evaluate(() => window.__rfCoop?.co?.lastSeq)]);
    if (a === b) return;
    await A.waitForTimeout(250);
  }
}

try {
  const A = await player('A');
  const B = await player('B');

  // ═════════ 1. лобби через UI ═════════
  await A.getByRole('button', { name: 'Подключить онлайн' }).click();
  await A.getByRole('button', { name: 'Создать лобби' }).click();
  await coopOnline(A);
  const code = await A.locator('input.coop-code').inputValue();
  ok('A создал лобби — код UUID в модалке', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(code), code);
  await A.screenshot({ path: out + 'coop-1-lobby.png' });
  await A.getByRole('button', { name: 'Играть' }).click();
  // A — в центре длинного прямоугольника пола стартовой комнаты
  const fa = await floorRect(A);
  const R = fa.rect;
  const alongX = R.x1 - R.x0 >= R.y1 - R.y0;
  const cx = (R.x0 + R.x1) / 2, cy = (R.y0 + R.y1) / 2;
  await place(A, cx, -cy, alongX ? cx + 5 : cx, alongX ? -cy : -cy - 5);
  await A.waitForTimeout(400);

  await B.getByRole('button', { name: 'Подключить онлайн' }).click();
  await B.locator('input.coop-code').fill(code);
  await B.getByRole('button', { name: 'Подключиться' }).click();
  await coopOnline(B);
  await B.getByRole('button', { name: 'Играть' }).click();
  await B.waitForTimeout(800);
  let sa = await state(A), sb = await state(B);
  ok('B в лобби: игроки видят список друг друга', sa.players.includes('B') && sb.players.includes('A'), `A: ${sa.players} · B: ${sb.players}`);
  ok('миры одинаковы (seq, отпечаток)', sa.seq === sb.seq && sa.fp === sb.fp, `${sa.seq}/${sb.seq} ${sa.fp === sb.fp ? '=' : sa.fp + ' ≠ ' + sb.fp}`);
  ok('B появился рядом с A (та же комната)', sb.room === sa.room && Math.hypot(sb.pos[0] - sa.pos[0], sb.pos[2] - sa.pos[2]) < 0.5, `A ${sa.room} · B ${sb.room}`);

  // ═════════ 2. видят друг друга ═════════
  // A — у одного края, B — у другого, лицом друг к другу
  const half = Math.max(0.6, Math.min(1.6, (alongX ? R.x1 - R.x0 : R.y1 - R.y0) / 2 - 0.35));
  const pa = alongX ? [cx - half, -cy] : [cx, -(cy - half)];
  const pb = alongX ? [cx + half, -cy] : [cx, -(cy + half)];
  await place(A, pa[0], pa[1], pb[0], pb[1]);
  await place(B, pb[0], pb[1], pa[0], pa[1]);
  await A.waitForTimeout(1200);
  sa = await state(A);
  sb = await state(B);
  ok('A видит аватар B, B видит аватар A (presence)', sa.shown.length === 1 && sb.shown.length === 1, `A: ${sa.shown.length} · B: ${sb.shown.length}`);
  const ca = await centerColor(A, out + 'coop-2-A-sees-B.png');
  const cb = await centerColor(B, out + 'coop-2-B-sees-A.png');
  ok('в центре кадра A — синий аватар B', bluish(ca), `rgb(${ca})`);
  ok('в центре кадра B — красный аватар A', reddish(cb), `rgb(${cb})`);

  // ═════════ 3. рядом — на 75% медленнее ═════════
  const dir = alongX ? [1, 0] : [0, -1];
  /** B уходит в соседнюю комнату (обычный шаг A меряем без него рядом) / возвращается к A */
  const bAway = () =>
    B.evaluate(() => {
      const d = window.__rf3dFold;
      const cur = d.portal?.current ?? d.current.center;
      // соседняя обычная комната (не спец-локация — там своя сцена)
      const plain = (id) => !d.run.instances.find((i) => i.id === id)?.location;
      const nb = d.run.links.map((x) => (x.a.inst === cur ? x.b.inst : x.b.inst === cur ? x.a.inst : null)).find((id) => id && plain(id));
      d.goTo(nb);
    });
  const bBack = async (x, z) => {
    await B.evaluate((id) => window.__rf3dFold.goTo(id), fa.room);
    await B.waitForTimeout(400);
    await place(B, x, z, pb[0], pb[1]);
  };
  // B далеко: обычный шаг
  await bAway();
  await A.waitForTimeout(800);
  await place(A, pa[0], pa[1], pb[0], pb[1]);
  const free = await walkFrames(A, dir[0], dir[1], 20);
  // B встал вплотную к A
  await place(A, pa[0], pa[1], pb[0], pb[1]);
  await bBack(pa[0] + dir[0] * 0.05, pa[1] + dir[1] * 0.05);
  await A.waitForTimeout(600);
  const slowA = await walkFrames(A, dir[0], dir[1], 20);
  sb = await state(B);
  sa = await state(A);
  ok('рядом: A идёт ×0.25 (замедление 75%)', free > 0.2 && Math.abs(slowA / free - 0.25) < 0.06, `свободно ${free.toFixed(3)} м, рядом ${slowA.toFixed(3)} м, ×${(slowA / free).toFixed(2)}`);
  ok('рядом: и B замедлен (у обоих)', sb.slowed === true, `B.slowed ${sb.slowed}`);
  const hud = await A.locator('.coop-hud').textContent();
  ok('HUD: «рядом игрок — шаг медленнее»', /медленнее/.test(hud ?? ''), hud ?? '');
  // разошлись — скорость обычная
  await bAway();
  await A.waitForTimeout(800);
  await place(A, pa[0], pa[1], pb[0], pb[1]);
  const free2 = await walkFrames(A, dir[0], dir[1], 20);
  ok('разошлись — снова обычный шаг', Math.abs(free2 / free - 1) < 0.1, `${free2.toFixed(3)} м`);

  // ═════════ 4. дверь: открыл A — открылась у B ═════════
  const ex = await A.evaluate(() => {
    const s = window.__rfWalk, d = window.__rf3dFold, w = s.world;
    const room = d.portal?.current ?? d.current.center;
    const cid = w.clusterAt(room)?.id;
    const list = [];
    for (const i of s.rx.instances) {
      if (w.clusterAt(i.id)?.id !== cid) continue;
      for (const k of i.connectors ?? []) if (k.exit) list.push({ inst: i.id, connector: k.id, len: k.len });
    }
    return list.sort((a, b) => b.len - a.len);
  });
  ok('в квартире есть закрытые выходы', ex.length > 0, `${ex.length}`);
  const door = ex[0];
  // оба — в комнате двери: A у самой двери, B в паре метров, смотрит на неё
  const stand = (page, dist, side = 0) =>
    page.evaluate(
      async ({ inst, connector, dist, side }) => {
        const d = window.__rf3dFold;
        d.goTo(inst);
        await new Promise((r) => setTimeout(r, 500));
        const de = d.deadEndAt(inst, connector);
        const c = window.__rf3d.fps;
        // поперёк — сторона (B чуть в стороне, чтобы не стоять на одной линии)
        const tx = -de.u.z, tz = de.u.x;
        c.position.set(de.center.x + de.u.x * dist + tx * side, de.center.y + 1.65, de.center.z + de.u.z * dist + tz * side);
        c.rotation.set(0.05, Math.atan2(de.center.x - c.position.x, de.center.z - c.position.z), 0);
        c.cameraDirection.setAll(0);
        return { cx: de.center.x, cz: de.center.z, ux: de.u.x, uz: de.u.z, depth: de.depth };
      },
      { ...door, dist, side },
    );
  const de = await stand(A, 0.8);
  await stand(B, Math.min(2.2, 1.6), 0.5);
  await A.waitForTimeout(900);
  // B следит за анимацией двери (ловит фазы)
  await B.evaluate(({ inst, connector }) => {
    window.__phases = new Set();
    const tick = () => {
      const ph = window.__rf3dFold.doors?.phaseOf(inst, connector);
      if (ph) window.__phases.add(ph);
      if (window.__phases.size < 8) requestAnimationFrame(tick);
    };
    tick();
  }, door);
  await A.waitForFunction(() => /открыть дверь/.test(document.querySelector('.v3-lift-prompt')?.textContent ?? ''), null, { timeout: 10000 });
  await A.locator('canvas').first().focus();
  await A.keyboard.press('KeyE');
  await until(B, ({ inst, connector }) => window.__rfWalk.world.doorState(inst, connector) === 'linked', door);
  await B.waitForTimeout(1800);
  const dB = await B.evaluate(({ inst, connector }) => {
    const s = window.__rfWalk;
    const k = s.rx.instances.find((i) => i.id === inst)?.connectors.find((c) => c.id === connector);
    return { state: s.world.doorState(inst, connector), opened: !!k?.opened, linked: k?.linkedTo?.inst ?? null, phases: [...window.__phases] };
  }, door);
  ok('A открыл дверь — у B она открыта (связь, полотно распахнуто)', dB.state === 'linked' && dB.opened && !!dB.linked, JSON.stringify(dB));
  // отпирание короткое — при ~10 кадрах/с его можно не поймать; главное — у B полотно шло анимацией
  ok('у B дверь распахнулась анимацией (распах)', dB.phases.includes('swing'), dB.phases.join(' → '));
  await sameSeq(A, B);
  sa = await state(A);
  sb = await state(B);
  ok('после двери миры одинаковы', sa.seq === sb.seq && sa.fp === sb.fp, `${sa.seq}/${sb.seq}`);
  await B.locator('canvas').first().screenshot({ path: out + 'coop-3-B-door-opened-by-A.png' });

  // ═════════ 5. сквозь проём: A за дверью, B видит его ═════════
  const target = dB.linked;
  await A.evaluate(async ({ cx, cz, ux, uz }) => {
    const c = window.__rf3d.fps;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    // через проём: от двери наружу (−u) на 0.9 м, кадрами (порог — смена комнаты)
    const tx = cx - ux * 0.9, tz = cz - uz * 0.9;
    for (let k = 0; k < 400; k++) {
      const dx = tx - c.position.x, dz = tz - c.position.z, d = Math.hypot(dx, dz);
      if (d < 0.05) break;
      c.cameraDirection.set((dx / d) * Math.min(0.04, d), 0, (dz / d) * Math.min(0.04, d));
      await frame();
    }
    c.cameraDirection.setAll(0);
    // лицом к проёму
    c.rotation.set(0.04, Math.atan2(cx - c.position.x, cz - c.position.z), 0);
  }, de);
  // B — прямо напротив проёма, смотрит в него
  await B.evaluate(({ cx, cz, ux, uz, depth }) => {
    const c = window.__rf3d.fps;
    const k = Math.max(0.8, Math.min(1.6, depth - 0.45));
    c.position.set(cx + ux * k, c.position.y, cz + uz * k);
    c.rotation.set(0.04, Math.atan2(-ux, -uz), 0);
    c.cameraDirection.setAll(0);
  }, de);
  await B.waitForTimeout(1500);
  sa = await state(A);
  sb = await state(B);
  ok('A прошёл в комнату за дверью', sa.room === target, `${sa.room} (за дверью ${target})`);
  ok('B видит A сквозь проём', sb.shown.length === 1, `shown ${sb.shown.length}`);
  const cThrough = await centerColor(B, out + 'coop-4-B-sees-A-through-door.png');
  ok('в центре кадра B — красный аватар A за проёмом', reddish(cThrough), `rgb(${cThrough})`);
  await A.locator('canvas').first().screenshot({ path: out + 'coop-4-A-looks-back.png' });

  // ═════════ 6. B открывает дверь — у A открылась ═════════
  const exB = await B.evaluate(() => {
    const s = window.__rfWalk, w = s.world;
    for (const i of s.rx.instances) for (const k of i.connectors ?? []) if (k.exit) return { inst: i.id, connector: k.id };
    return null;
  });
  if (exB) {
    const rb = await B.evaluate(({ inst, connector }) => window.__rfWalk.request({ k: 'door', inst, conn: connector }), exB);
    await until(A, ({ inst, connector }) => window.__rfWalk.world.doorState(inst, connector) === 'linked', exB);
    await sameSeq(A, B);
    sa = await state(A);
    sb = await state(B);
    ok('B открыл дверь — у A открыта, миры одинаковы', !!rb && sa.seq === sb.seq && sa.fp === sb.fp, `${rb} · seq ${sa.seq}/${sb.seq}`);
  }

  // ═════════ 6б. снег: B ползком (аватар лежит, не под полом); B засыпан — A откапывает ═════════
  {
    // оба — в комнате A, вдоль длинного прямоугольника пола, в 1.1 м друг от друга
    const fr = await floorRect(A);
    await B.evaluate((id) => window.__rf3dFold.goTo(id), fr.room);
    await B.waitForTimeout(600);
    const r = fr.rect;
    const ax = r.x1 - r.x0 >= r.y1 - r.y0;
    const mx = (r.x0 + r.x1) / 2, my = (r.y0 + r.y1) / 2;
    const qa = ax ? [mx - 0.55, -my] : [mx, -(my - 0.55)];
    const qb = ax ? [mx + 0.55, -my] : [mx, -(my + 0.55)];
    await place(A, qa[0], qa[1], qb[0], qb[1]);
    // B ползком: эллипсоид как у SnowWalk в лазе (глаза 0.5 м) — камера опускается к полу
    await B.evaluate(({ x, z, lx, lz }) => {
      const c = window.__rf3d.fps;
      // как SnowWalk: глаза опускаются вместе с эллипсоидом (1.6 → 0.5 м над полом)
      c.ellipsoid.set(0.25, 0.28, 0.25);
      c.ellipsoidOffset.set(0, 2 * 0.28 - 0.5, 0);
      c.position.set(x, c.position.y - 1.1, z);
      c.rotation.set(0.04, Math.atan2(lx - x, lz - z), 0);
      c.cameraDirection.setAll(0);
    }, { x: qb[0], z: qb[1], lx: qa[0], lz: qa[1] });
    await A.waitForFunction(() => Math.abs(([...window.__rfCoop.co.players.values()][0]?.state?.eye ?? 9) - 0.5) < 0.05, null, { timeout: 30000 }).catch(() => {});
    await A.waitForTimeout(1200);
    const lying = await A.evaluate(() => {
      const p = window.__rfCoop.presence;
      const s = [...window.__rfCoop.co.players.values()][0]?.state;
      return { eye: s?.eye ?? null, shown: p.shown.length, py: s?.p[1] ?? null, room: s?.room ?? null };
    });
    const camB = await B.evaluate(() => {
      const d = window.__rf3dFold;
      const room = d.portal?.current ?? d.current.center;
      const z = d.portal.cache.peek(room)?.model.floors.find((f) => f.inst === room)?.z ?? null;
      return { y: window.__rf3d.fps.position.y, room, floorZ: z };
    });
    const camA = await A.evaluate(() => {
      const d = window.__rf3dFold;
      const room = d.portal?.current ?? d.current.center;
      const z = d.portal.cache.peek(room)?.model.floors.find((f) => f.inst === room)?.z ?? null;
      return { y: window.__rf3d.fps.position.y, room, floorZ: z };
    });
    console.log('  диагностика ползком:', JSON.stringify({ lying, camA, camB }));
    // пол комнаты B — по модели её куска (камера A может стоять не на полу)
    const floorY = camB.floorZ ?? 0;
    const bodyY = await A.evaluate(() => window.__rf3d.scene.meshes.find((m) => m.name.startsWith('coop:body:'))?.position.y ?? null);
    ok('B ползком: A получает высоту глаз ~0.5 м, аватар лежит над полом (не под ним)', lying.eye !== null && Math.abs(lying.eye - 0.5) < 0.05 && bodyY !== null && bodyY > floorY + 0.1 && bodyY < floorY + 0.5, `eye ${lying.eye}, тело на ${(bodyY - floorY).toFixed(2)} м над полом`);
    await A.locator('canvas').first().screenshot({ path: out + 'coop-5-A-sees-B-crawling.png' });
    // B засыпан (как после обвала у его места)
    await B.evaluate(({ x, z }) => {
      const st = window.__rfSnow.collapse;
      st.phase = 'buried';
      st.site = { inst: 'qa', connector: 'qa', x, y: -z };
      st.dig = 0;
      st.t = 0;
    }, { x: qb[0], z: qb[1] });
    await A.waitForFunction(() => /откапывать/.test(document.querySelector('.v3-lift-prompt')?.textContent ?? ''), null, { timeout: 30000 });
    const prompt = await A.locator('.v3-lift-prompt').first().textContent();
    ok('A рядом с засыпанным B — «E — откапывать: B»', /откапывать: B/.test(prompt ?? ''), prompt ?? '');
    await A.locator('canvas').first().focus();
    const digs = [];
    for (let k = 0; k < 4; k++) {
      await A.keyboard.press('KeyE');
      await B.waitForTimeout(250);
      digs.push(await B.evaluate(() => `${window.__rfSnow.collapse.phase}:${window.__rfSnow.collapse.dig.toFixed(2)}`));
    }
    ok('A откопал B за 4 нажатия (digMate), у B — «откапывает»', digs[3].startsWith('calm') && digs[0] === 'buried:0.25', digs.join(' → '));
    // B снова на ногах
    await B.evaluate(() => {
      const c = window.__rf3d.fps;
      c.ellipsoid.set(0.3, 0.85, 0.3);
      c.ellipsoidOffset.set(0, 0.1, 0);
      c.position.y += 1.1;
    });
    await B.waitForTimeout(800);
  }

  // ═════════ 7. перезагрузка B — возврат в лобби; выход ═════════
  const posB = (await state(B)).pos;
  await B.reload({ timeout: 180000 });
  await B.getByRole('button', { name: '3D', exact: true }).click({ timeout: 180000 });
  await coopOnline(B);
  await B.waitForTimeout(1500);
  await sameSeq(A, B);
  sa = await state(A);
  sb = await state(B);
  ok('B после перезагрузки вернулся в лобби, мир тот же', sa.seq === sb.seq && sa.fp === sb.fp && sb.players.includes('A'), `${sa.seq}/${sb.seq}`);
  ok('…на своё место', Math.hypot(sb.pos[0] - posB[0], sb.pos[2] - posB[2]) < 0.3, `${posB.map((x) => x.toFixed(2))} → ${sb.pos.map((x) => x.toFixed(2))}`);
  await B.getByRole('button', { name: 'Выйти', exact: true }).click();
  await A.waitForTimeout(800);
  sa = await state(A);
  ok('B вышел — у A его нет (список, аватар)', sa.players.length === 0 && sa.shown.length === 0, `${sa.players}`);
  const solo = await B.evaluate(() => !window.__rfCoop && !!window.__rfWalk);
  ok('B вернулся в свою одиночную прогулку', solo);
} catch (e) {
  console.error(e);
  ok('сценарий без исключений', false, String(e?.message ?? e).slice(0, 400));
} finally {
  ok('без ошибок на страницах', errors.length === 0, errors.slice(0, 5).join(' | '));
  console.log('загрузок страниц:', JSON.stringify(loads), '(A — 2, B — 3: первая, с настройками, перезагрузка в п. 7)');
  if (results.some((r) => !r.ok)) console.log(`\n── лог vite ──\n${serverLog.slice(-3000)}`);
  await browser.close();
  await stopServer();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} OK`);
  process.exit(bad.length ? 1 : 0);
}
