// QA модели кооп-аватара «забинтованный в шинели» (src/coop/avatarModel.ts, src/coop/presence.ts, docs/COOP.md):
// два игрока — два браузера (у каждого свой GPU-процесс swiftshader — кадров больше), лобби через UI, мир — обычная
// «Прогулка» (хрущёвка; --biome=<id> — другой). Оба — в комнате квартиры, где у B прямой путь 2–3 м без мебели, а A
// стоит в 1+ м от него (не «рядом» — без замедления) и видит весь путь. Камеру наблюдателя ставим сами (кадр);
// наблюдаемый ходит «как игрок» — зажатая W, C — поза. Кадры — из самой страницы (toDataURL в конце кадра движка:
// без задержки скриншота playwright, без HUD) вместе с данными аватара этого же кадра.
//  1. Стоят: A видит модель B, B — модель A; ноги на полу, лицом по взгляду, правая кисть справа, табличка над головой;
//     шинель у B (место 1) бурее, чем у A (место 0) — coat из presence.shown и пиксель груди на кадре.
//  2. B идёт (W): у A клип Walk главный, скорость аватара (м/с) — для калибровки WALK_MPS; кадр на ходу.
//  3. B — C: на четвереньки (поза у пола, голова вперёд); сбоку у пола (A тоже ползком); ползёт (W) — скорость, клипы
//     (CRAWL_MPS). Скрючившись (C туда не ведёт) — через posture.set('crouch'): кадр и габарит.
//  4. Скелет анимирован: портальный рендер (по умолчанию) — матрицы костей меняются; B за проёмом в соседней комнате;
//     рендер «набор (PVS)» у A — модель видна и анимирована, на ходу — Walk.
//  5. Читаемость: яркость модели на кадре против фона.
//  6. Фонарик B: модель в правой кисти, луч по взгляду (стоя и ползком).
//  7. Ошибки и предупреждения страниц.
// Кадры — tools/qa/avatar-*.png.   node tools/qa-coop-avatar.mjs [--biome=barn]
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const PORT = 5347;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const BIOME = process.argv.find((a) => a.startsWith('--biome='))?.slice(8) ?? null;
const PFX = BIOME ? `avatar-${BIOME}-` : 'avatar-';
const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.qa.config.ts', import.meta.url)),
  root: ROOT,
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-qa-avatar', import.meta.url)),
  server: { port: PORT, strictPort: true },
  logLevel: 'warn',
});
await server.listen();
const BASE = `http://localhost:${PORT}/`;
const launch = () =>
  chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
const browsers = [];
const results = [];
const ok = (name, cond, info = '') => {
  results.push({ name, ok: !!cond, info });
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};
const T0 = Date.now();
const note = (s) => console.log(`     [${((Date.now() - T0) / 1000).toFixed(0)} с] ${s}`);
const errors = [];
const warnings = [];
const NOISE = /pointer ?lock|WebSocket|ERR_CONNECTION_REFUSED|Failed to fetch|GPU stall|GroupMarkerNotSet|swiftshader|Automatic fallback to software WebGL/i;
const COLORS = { A: '#e0563f', B: '#4fb3e8' };
const f2 = (x) => (x == null || !Number.isFinite(+x) ? 'null' : (+x).toFixed(2));
const f3 = (x) => (x == null || !Number.isFinite(+x) ? 'null' : (+x).toFixed(3));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── в странице ─────────────────────────

/** Аватар напарника у меня (window.__qaMate): модель (габарит со скелетом — если не light, кости), табличка, клипы,
 *  шинель, фонарь; точки экрана 0…1. */
function MATE(light = false) {
  const p = window.__rfCoop?.presence;
  const a = p && [...p['avatars'].values()][0];
  if (!a) return null;
  const sh = p.shown.find((s) => s.id === a.id) ?? null;
  const st = window.__rfCoop.co.players.get(a.id)?.state ?? null;
  const v = window.__rfViewer, d = window.__rf3dFold;
  const m = a.model;
  const V = (q) => (q ? [+q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3)] : null);
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  // в экран (0…1): Babylon — строка × матрица (вид·проекция)
  const M = v.scene.getTransformMatrix().m;
  const scr = (q) => {
    const cx = q.x * M[0] + q.y * M[4] + q.z * M[8] + M[12];
    const cy = q.x * M[1] + q.y * M[5] + q.z * M[9] + M[13];
    const cw = q.x * M[3] + q.y * M[7] + q.z * M[11] + M[15];
    return cw > 0 ? [+((cx / cw + 1) / 2).toFixed(3), +((1 - cy / cw) / 2).toFixed(3)] : null;
  };
  const r = {
    id: a.id, slot: a.slot, room: a.room, myRoom: d.portal?.isActive ? d.portal.current : d.current.center, visible: a.visible,
    state: st ? { eye: st.eye ?? 1.6, p: st.p, yaw: st.yaw, pitch: st.pitch, torch: st.torch ?? null } : null,
    shown: sh && { ...sh, speed: +sh.speed.toFixed(3), clips: Object.fromEntries(Object.entries(sh.clips ?? {}).map(([k, x]) => [k, +x.toFixed(2)])) },
    label: { pos: V(a.label.position), on: a.label.isEnabled(), scr: scr(a.label.position) },
    model: null,
  };
  if (!m) return r;
  const desc = (a.__qaDesc ??= m.root.getDescendants(false));
  const nd = (s) => desc.find((n) => n.name.endsWith(':' + s));
  const pos = (s) => nd(s)?.getAbsolutePosition().clone() ?? null;
  const head = m.head.getAbsolutePosition().clone();
  const root = m.root.position.clone();
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
  const fwd = (q) => (q.x - root.x) * fx + (q.z - root.z) * fz;
  const side = (q) => (q.x - root.x) * fz - (q.z - root.z) * fx;
  const hr = pos('Hand.R'), hl = pos('Hand.L'), chest = pos('Chest'), hips = pos('Hips'), footL = pos('Foot.L'), footR = pos('Foot.R');
  r.model = {
    enabled: m.root.isEnabled(), meshes: m.meshes.length, layer: m.meshes[0]?.layerMask,
    meshesEnabled: m.meshes.filter((x) => x.isEnabled() && x.isVisible).length,
    root: V(root), rootYaw: +m.root.rotation.y.toFixed(3), squash: +m.root.scaling.y.toFixed(3),
    head: V(head), headFwd: +fwd(head).toFixed(3), headAboveFeet: +(head.y - root.y).toFixed(3),
    handRSide: +side(hr).toFixed(3), handLSide: +side(hl).toFixed(3), handRUp: +(hr.y - root.y).toFixed(3), handLUp: +(hl.y - root.y).toFixed(3),
    handFwdDiff: +(fwd(hl) - fwd(hr)).toFixed(3),
    footFwdDiff: +(fwd(footL) - fwd(footR)).toFixed(3), footLUp: +(footL.y - root.y).toFixed(3), footRUp: +(footR.y - root.y).toFixed(3),
  };
  if (light) return r;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const meshMin = [];
  for (const mesh of m.meshes) {
    mesh.refreshBoundingInfo({ applySkeleton: true });
    mesh.computeWorldMatrix(true);
    const b = mesh.getBoundingInfo().boundingBox;
    meshMin.push([mesh.material?.name?.replace(/^coop:avatar:\d+ \| /, '') ?? mesh.name, +(b.minimumWorld.y - root.y).toFixed(3)]);
    for (let k = 0; k < 3; k++) {
      const key = 'xyz'[k];
      min[k] = Math.min(min[k], b.minimumWorld[key]);
      max[k] = Math.max(max[k], b.maximumWorld[key]);
    }
  }
  const boneY = {};
  for (const b of ['Hips', 'Chest', 'Head', 'Shin.L', 'Foot.L', 'Shin.R', 'Foot.R', 'Hand.L', 'Hand.R']) {
    const q = pos(b);
    if (q) boneY[b] = [+(q.y - root.y).toFixed(3), +fwd(q).toFixed(3)];
  }
  // матрицы костей, которые уходят в шейдер (скиннинг): сумма модулей — «отпечаток» позы
  const sk = m.entries?.skeletons?.[0];
  let skSum = null, skId = null;
  if (sk) {
    const t = sk.getTransformMatrices(m.meshes[0]);
    skSum = 0;
    for (let i = 0; i < t.length; i++) skSum += Math.abs(t[i]);
    skId = true;
    for (let b = 0; b < t.length / 16 && skId; b++)
      for (let i = 0; i < 16; i++)
        if (Math.abs(t[b * 16 + i] - (i % 5 === 0 ? 1 : 0)) > 1e-4) {
          skId = false;
          break;
        }
  }
  const bodyMid = { x: (chest.x * 2 + hips.x) / 3, y: (chest.y * 2 + hips.y) / 3, z: (chest.z * 2 + hips.z) / 3 };
  Object.assign(r.model, {
    bbMin: min.map((x) => +x.toFixed(3)), bbMax: max.map((x) => +x.toFixed(3)), height: +(max[1] - min[1]).toFixed(3), meshMin, boneY, skSum, skIdentity: skId,
    scr: { head: scr(head), chest: scr(bodyMid), feet: scr(root), top: scr({ x: root.x, y: max[1], z: root.z }) },
  });
  if (a.torch) {
    const tr = a.torch.m.root, l = a.torch.l;
    const tp = tr.getAbsolutePosition();
    r.torch = {
      model: tr.isEnabled(), light: l.isEnabled(), intensity: +l.intensity.toFixed(2),
      pos: V(tp), distToHandR: +dist(tp, hr).toFixed(3), distToHandL: +dist(tp, hl).toFixed(3),
      dir: V(l.direction), lightPos: V(l.position),
      gaze: [+(Math.sin(a.yaw) * Math.cos(a.pitch)).toFixed(3), +(-Math.sin(a.pitch)).toFixed(3), +(Math.cos(a.yaw) * Math.cos(a.pitch)).toFixed(3)],
      scr: scr(tp), scrHand: scr(hr),
    };
  }
  return r;
}

/** Комната квартиры для наблюдения за ходом B: прямой путь B 2–3 м без мебели (вдоль x или y плана), A — свободное место
 *  в 1+ м от пути (не «рядом» — без замедления), в ≤ 3.4 м от его середины, весь путь в поле зрения и без мебели выше
 *  0.6 м на линии взгляда. План: x, y↓. */
function PICK() {
  const d = window.__rf3dFold, cache = d.portal.cache, rx = d.run, w = window.__rfWalk.world;
  const T = performance.now();
  const cur = d.portal.current;
  const cid = w?.clusterAt?.(cur)?.id;
  let best = null;
  const rooms = [];
  for (const inst of rx.instances) {
    if (inst.location) continue;
    if (cid !== undefined && w.clusterAt(inst.id)?.id !== cid) continue;
    let model;
    try {
      model = cache.model(inst.id).model;
    } catch {
      continue;
    }
    const f = model.floors.find((x) => x.inst === inst.id);
    if (!f) continue;
    const boxes = model.props
      .filter((p) => p.inst === inst.id && !(p.z > 1.2))
      .map((p) => {
        const q = Math.round((((p.rot % 180) + 180) % 180) / 90) % 2;
        const hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2;
        return { x0: p.x - hw, x1: p.x + hw, y0: p.y - hd, y1: p.y + hd, h: p.h };
      });
    const free = (x, y, m) => f.rects.some((r) => x >= r.x0 + m && x <= r.x1 - m && y >= r.y0 + m && y <= r.y1 - m) && !boxes.some((b) => x > b.x0 - m && x < b.x1 + m && y > b.y0 - m && y < b.y1 + m);
    const tall = boxes.filter((b) => b.h > 0.6);
    const sees = (p, q) => {
      const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.05);
      for (let i = 1; i < n; i++) {
        const x = p[0] + ((q[0] - p[0]) * i) / n, y = p[1] + ((q[1] - p[1]) * i) / n;
        if (!f.rects.some((r) => x >= r.x0 - 0.01 && x <= r.x1 + 0.01 && y >= r.y0 - 0.01 && y <= r.y1 + 0.01)) return false;
        if (tall.some((b) => x > b.x0 - 0.05 && x < b.x1 + 0.05 && y > b.y0 - 0.05 && y < b.y1 + 0.05)) return false;
      }
      return true;
    };
    const spots = [];
    for (const r of f.rects) for (let x = r.x0 + 0.4; x <= r.x1 - 0.4 + 1e-6; x += 0.2) for (let y = r.y0 + 0.4; y <= r.y1 - 0.4 + 1e-6; y += 0.2) if (free(x, y, 0.35)) spots.push([x, y]);
    let roomBest = null;
    for (const r of f.rects) {
      for (const axis of [0, 1]) {
        const L0 = axis ? r.y0 : r.x0, L1 = axis ? r.y1 : r.x1, W0 = axis ? r.x0 : r.y0, W1 = axis ? r.x1 : r.y1;
        const P = (u, v) => (axis ? [v, u] : [u, v]);
        for (let wv = W0 + 0.4; wv <= W1 - 0.4 + 1e-6; wv += 0.1)
          for (const dir of [1, -1])
            for (let u0 = L0 + 0.4; u0 <= L1 - 0.4 + 1e-6; u0 += 0.1) {
              const s0 = dir > 0 ? u0 : L0 + L1 - u0;
              if (!free(...P(s0, wv), 0.35)) continue;
              let len = 0;
              while (len < 3.0 && free(...P(s0 + dir * (len + 0.1), wv), 0.35)) len += 0.1;
              if (len < 2.0) continue;
              const a = P(s0, wv), b = P(s0 + dir * len, wv), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
              const vx = b[0] - a[0], vy = b[1] - a[1], vl = Math.hypot(vx, vy);
              for (const sp of spots) {
                const t = Math.max(0, Math.min(1, ((sp[0] - a[0]) * vx + (sp[1] - a[1]) * vy) / (vl * vl)));
                const dmin = Math.hypot(sp[0] - a[0] - vx * t, sp[1] - a[1] - vy * t);
                const dmid = Math.hypot(sp[0] - mx, sp[1] - my);
                if (dmin < 1.0 || dmid > 3.4) continue;
                const ang = (p) => Math.abs(Math.atan2((p[0] - sp[0]) * (my - sp[1]) - (p[1] - sp[1]) * (mx - sp[0]), (p[0] - sp[0]) * (mx - sp[0]) + (p[1] - sp[1]) * (my - sp[1])));
                if (Math.max(ang(a), ang(b)) > 0.5) continue;
                let vis = true;
                for (const k of [0, 0.25, 0.5, 0.75, 1]) {
                  const px = a[0] + vx * k, py = a[1] + vy * k, nx = (-vy / vl) * 0.3, ny = (vx / vl) * 0.3;
                  if (!sees(sp, [px, py]) || !sees(sp, [px + nx, py + ny]) || !sees(sp, [px - nx, py - ny])) {
                    vis = false;
                    break;
                  }
                }
                if (!vis) continue;
                const score = len + Math.min(dmin, 1.8) * 1.5 - Math.abs(dmid - 2.4) * 0.3;
                if (!roomBest || score > roomBest.score) roomBest = { room: inst.id, score, len, dmin, dmid, b0: a, b1: b, a: sp, z: f.z };
              }
            }
      }
    }
    rooms.push(`${inst.id}:${f.rects.map((r) => `${(r.x1 - r.x0).toFixed(1)}×${(r.y1 - r.y0).toFixed(1)}`).join('+')}${roomBest ? `(${roomBest.score.toFixed(1)})` : ''}`);
    if (roomBest && (!best || roomBest.score > best.score)) best = roomBest;
  }
  return { best, rooms, cur, ms: performance.now() - T };
}

/** Проёмы комнаты (портальный рендер) и место A напротив проёма (на оси, без мебели до проёма, 1.4–2.6 м). */
function DOORWAYS(room) {
  const d = window.__rf3dFold, rx = d.run;
  const piece = d.portal.cache.get(room);
  const model = piece.model;
  const f = model.floors.find((x) => x.inst === room);
  const boxes = model.props
    .filter((p) => p.inst === room && !(p.z > 1.2))
    .map((p) => {
      const q = Math.round((((p.rot % 180) + 180) % 180) / 90) % 2;
      const hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2;
      return { x0: p.x - hw, x1: p.x + hw, y0: p.y - hd, y1: p.y + hd };
    });
  const free = (x, y, m) => f.rects.some((r) => x >= r.x0 + m && x <= r.x1 - m && y >= r.y0 + m && y <= r.y1 - m) && !boxes.some((b) => x > b.x0 - m && x < b.x1 + m && y > b.y0 - m && y < b.y1 + m);
  const res = [];
  for (const q of piece.portals) {
    if (q.shiftB || q.to === room || rx.instances.find((i) => i.id === q.to)?.location) continue;
    const c = q.center, u = q.u;
    let k = null;
    for (let t = 2.6; t >= 1.4; t -= 0.1) {
      let clear = true;
      for (let s = 0.3; s <= t && clear; s += 0.1) clear = free(c.x - u.x * s, -(c.z - u.z * s), s >= t - 1e-6 ? 0.35 : 0.15);
      if (clear) {
        k = t;
        break;
      }
    }
    res.push({ to: q.to, c: [c.x, c.y, c.z], u: [u.x, u.z], k });
  }
  return res.sort((p, q) => (q.k ?? 0) - (p.k ?? 0));
}

// ───────────────────────── игроки и помощники ─────────────────────────

async function player(name) {
  const browser = await launch();
  browsers.push(browser);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript({ content: `window.__qaMate = ${MATE.toString()};` });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} PAGEERROR ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (NOISE.test(t)) return;
    if (m.type() === 'error') errors.push(`${name} ${t.slice(0, 300)}`);
    else if (m.type() === 'warning') warnings.push(`${name} ${t.slice(0, 300)}`);
  });
  await page.goto(BASE, { timeout: 180000 });
  await page.evaluate(
    ({ name, color, biome }) => {
      const walk = { seed: 'qa-avatar', deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, on: true };
      if (biome) walk.biome = biome;
      localStorage.setItem('room-forge/walk', JSON.stringify(walk));
      localStorage.setItem('room-forge/coop/profile', JSON.stringify({ name, color, server: '', lastLobby: '' }));
      localStorage.setItem('room-forge/flashlight-sound', '0');
    },
    { name, color: COLORS[name], biome: BIOME },
  );
  await page.reload({ timeout: 180000 });
  await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 180000 });
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
  return page;
}
const online = (page) => page.waitForFunction(() => window.__rfCoop?.co?.status === 'online' && window.__rf3dFold?.portal?.isActive && window.__rfInv, null, { timeout: 180000 });
const canvas = (page) => page.locator('.v3-stage canvas').first();
const focus = (page) => canvas(page).focus();
const goTo = async (page, id) => {
  await page.evaluate((id) => window.__rf3dFold.goTo(id), id);
  await page.waitForTimeout(900);
};
const mate = (page, light = false) => page.evaluate((light) => window.__qaMate(light), light);

/** Камера: в (x, z) Babylon (высота — своя), взгляд на точку (tx, ty, tz); ty null — горизонт + pitch. */
const aim = (page, x, z, tx, ty, tz, pitch = 0.04) =>
  page.evaluate(
    ({ x, z, tx, ty, tz, pitch }) => {
      const c = window.__rfViewer.fps;
      c.position.set(x, c.position.y, z);
      const dx = tx - x, dz = tz - z;
      const p = ty == null ? pitch : Math.atan2(c.position.y - ty, Math.hypot(dx, dz));
      c.rotation.set(p, Math.atan2(dx, dz), 0);
      c.cameraDirection.setAll(0);
      c.cameraRotation.set(0, 0);
    },
    { x, z, tx, ty, tz, pitch },
  );
const turn = (page, yaw, pitch) =>
  page.evaluate(
    ({ yaw, pitch }) => {
      const c = window.__rfViewer.fps;
      c.rotation.set(pitch, yaw, 0);
      c.cameraRotation.set(0, 0);
    },
    { yaw, pitch },
  );
/** Свои ноги, глаз, комната. */
const me = (page) =>
  page.evaluate(() => {
    const v = window.__rfViewer, d = window.__rf3dFold, c = v.fps;
    const room = d.portal?.isActive ? d.portal.current : d.current.center;
    return { room, x: c.position.x, y: c.position.y, z: c.position.z, eye: v.posture.eye, pose: v.posture.pose, flat: v.posture.flat, feet: c.position.y - v.posture.eye, yaw: c.rotation.y, pitch: c.rotation.x, fps: v.engine?.getFps?.() ?? null };
  });

/** Кадр из страницы: в конце следующего кадра движка — PNG холста и данные аватара этого кадра. */
async function capture(page, file) {
  const r = await page.evaluate(
    () =>
      new Promise((res) => {
        const eng = window.__rfViewer.engine;
        eng.onEndFrameObservable.addOnce(() => res({ url: eng.getRenderingCanvas().toDataURL('image/png'), info: window.__qaMate(), t: Date.now() }));
      }),
  );
  const png = Buffer.from(r.url.slice(r.url.indexOf(',') + 1), 'base64');
  if (file) writeFileSync(out + PFX + file, png);
  return { png, info: r.info, t: r.t };
}

/** Средний цвет квадрата (s×s) вокруг точки экрана (0…1) кадра. */
async function colorAt(png, pt, s = 10) {
  if (!pt) return null;
  const img = sharp(png);
  const { width, height } = await img.metadata();
  const left = Math.max(0, Math.min(width - s, Math.round(pt[0] * width - s / 2)));
  const top = Math.max(0, Math.min(height - s, Math.round(pt[1] * height - s / 2)));
  const { data, info } = await img.extract({ left, top, width: s, height: s }).raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const n = data.length / info.channels;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
/** Средняя яркость (0…255) прямоугольника экрана [x0,y0,x1,y1] (0…1). */
async function lumaRect(png, [x0, y0, x1, y1]) {
  const img = sharp(png);
  const { width, height } = await img.metadata();
  const left = Math.max(0, Math.round(Math.min(x0, x1) * width)), top = Math.max(0, Math.round(Math.min(y0, y1) * height));
  const w = Math.max(2, Math.min(width - left, Math.round(Math.abs(x1 - x0) * width))), h = Math.max(2, Math.min(height - top, Math.round(Math.abs(y1 - y0) * height)));
  const { data, info } = await img.extract({ left, top, width: w, height: h }).raw().toBuffer({ resolveWithObject: true });
  let s = 0;
  for (let i = 0; i < data.length; i += info.channels) s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  return Math.round(s / (data.length / info.channels));
}

/** Пробы раз в 100 мс (время — Date.now, общее для страниц): у наблюдателя — скорость, клипы, ноги аватара; у идущего —
 *  его камера. */
const startSampler = (page, observer) =>
  page.evaluate((observer) => {
    window.__qaSamp = [];
    window.__qaSampT = setInterval(() => {
      const t = Date.now();
      if (observer) {
        const m = window.__qaMate(true);
        window.__qaSamp.push({ t, speed: m?.shown?.speed ?? null, clips: m?.shown?.clips ?? null, foot: m?.model?.footFwdDiff ?? null, hand: m?.model?.handFwdDiff ?? null, eye: m?.state?.eye ?? null });
      } else {
        const c = window.__rfViewer.fps.position;
        window.__qaSamp.push({ t, x: c.x, z: c.z, eye: window.__rfViewer.posture.eye, fps: window.__rfViewer.engine?.getFps?.() ?? null });
      }
    }, 100);
  }, observer);
const stopSampler = (page) =>
  page.evaluate(() => {
    clearInterval(window.__qaSampT);
    return window.__qaSamp;
  });
const median = (xs) => {
  const a = xs.filter((x) => x != null && Number.isFinite(x)).sort((p, q) => p - q);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};
const mean = (xs) => {
  const a = xs.filter((x) => x != null && Number.isFinite(x));
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
};
function clipMean(samp) {
  const a = samp.filter((s) => s.clips);
  if (!a.length) return null;
  const o = {};
  for (const k of Object.keys(a[0].clips)) o[k] = +(a.reduce((s, x) => s + (x.clips[k] ?? 0), 0) / a.length).toFixed(2);
  return o;
}

/**
 * Ход «как игрок» по пути from → to: B стоит в from лицом к to, зажимает key и отпускает на доле stopAt пути (или по
 * времени / упёрся). Кадр у наблюдателя (из страницы) — когда его аватар B прошёл долю shotAt пути и клип clip уже
 * главный (не по положению самого B: у наблюдателя аватар отстаёт на сеть и кадры). Истинная скорость — по камере B на
 * участке 20–80 % пути; у наблюдателя — пробы того же времени (+150 мс на сеть и сглаживание). До tries попыток, пока
 * кадр не придётся на ход (клип > 0.5).
 */
async function walk(walker, observer, from, to, { key = 'KeyW', shotAt = 0.45, stopAt = 0.75, maxMs = 8000, file, clip = 'Walk', tries = 3, look = null } = {}) {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  let res = null;
  for (let k = 0; k < tries; k++) {
    await aim(walker, from[0], from[1], to[0], null, to[1]);
    if (look) await look();
    await walker.waitForTimeout(1500);
    await startSampler(observer, true);
    await startSampler(walker, false);
    await focus(walker);
    const t0 = Date.now();
    await walker.keyboard.down(key);
    let shotP = null, d = 0, stalled = false, held = null;
    while (Date.now() - t0 < maxMs + 4000) {
      if (held === null) {
        const p = await me(walker);
        d = Math.hypot(p.x - from[0], p.z - from[1]);
        stalled = Date.now() - t0 > 2500 && d < 0.1;
        if (d >= stopAt * len || stalled || Date.now() - t0 > maxMs) {
          await walker.keyboard.up(key);
          held = Date.now() - t0;
        }
      }
      if (!shotP) {
        const o = await mate(observer, true);
        const op = o?.shown?.pos;
        const od = op ? Math.hypot(op[0] - from[0], op[2] - from[1]) : 0;
        if (od >= shotAt * len && (o.shown.clips?.[clip] ?? 0) > 0.8) shotP = capture(observer, file);
      }
      if (held !== null && (shotP || Date.now() - t0 > held + 4000)) break;
      await sleep(40);
    }
    if (held === null) {
      await walker.keyboard.up(key);
      held = Date.now() - t0;
    }
    const cap = shotP ? await shotP : null;
    await walker.waitForTimeout(1300);
    const so = await stopSampler(observer);
    const sw = await stopSampler(walker);
    // истинная скорость: участок 20–80 % пути
    const dist = (s) => Math.hypot(s.x - from[0], s.z - from[1]);
    const i0 = sw.findIndex((s) => dist(s) >= 0.2 * d), i1 = sw.findIndex((s) => dist(s) >= 0.8 * d);
    const trueV = i0 >= 0 && i1 > i0 ? (dist(sw[i1]) - dist(sw[i0])) / ((sw[i1].t - sw[i0].t) / 1000) : null;
    const win = i0 >= 0 && i1 > i0 ? so.filter((s) => s.t >= sw[i0].t + 150 && s.t <= sw[i1].t + 150) : [];
    res = {
      held, d, len, stalled, cap, so, sw, trueV, win,
      obsMedian: median(win.map((s) => s.speed)), obsMean: mean(win.map((s) => s.speed)), clips: clipMean(win),
      footMax: Math.max(0, ...so.map((s) => Math.abs(s.foot ?? 0))), handMax: Math.max(0, ...so.map((s) => Math.abs(s.hand ?? 0))),
      fps: median(sw.map((s) => s.fps)), last: so.at(-1)?.clips ?? null,
    };
    // кадр — на ходу (и для шага — не в миг, когда стопы проходят друг мимо друга)
    if (cap?.info?.shown?.clips?.[clip] > 0.5 && (clip !== 'Walk' || Math.abs(cap.info.model?.footFwdDiff ?? 0) > 0.08)) break;
    note(`попытка ${k + 1}: кадр не на ходу (клипы ${JSON.stringify(cap?.info?.shown?.clips)}, прошёл ${f2(d)} м за ${held} мс) — ещё раз`);
  }
  return res;
}
const walkNote = (tag, w) => {
  note(`${tag}: W ${w.held} мс, прошёл ${f2(w.d)} из ${f2(w.len)} м${w.stalled ? ' (упёрся)' : ''}; к/с у идущего ~${f2(w.fps)}`);
  note(`${tag}: истинная скорость (камера, 20–80 % пути) ${f2(w.trueV)} м/с; у наблюдателя speed аватара на том же отрезке: медиана ${f2(w.obsMedian)}, среднее ${f2(w.obsMean)} (${w.win.length} проб); клипы ${JSON.stringify(w.clips)}`);
  note(`${tag}: пробы наблюдателя (с:м/с:стопы) ${w.so.map((s) => `${((s.t - w.so[0].t) / 1000).toFixed(1)}:${f2(s.speed)}:${f2(s.foot)}`).join(' ')}`);
  note(`${tag}: пробы идущего (с:путь) ${w.sw.map((s) => `${((s.t - w.so[0].t) / 1000).toFixed(1)}:${f2(Math.hypot(s.x - w.sw[0].x, s.z - w.sw[0].z))}`).join(' ')}`);
  note(`${tag}: размах ног (стопы вперёд-назад, макс) ${f3(w.footMax)} м, рук ${f3(w.handMax)} м; кадр: клипы ${JSON.stringify(w.cap?.info?.shown?.clips)}, speed ${f2(w.cap?.info?.shown?.speed)}, стопы ${f3(w.cap?.info?.model?.footFwdDiff)}, низ ${f3(w.cap?.info?.model?.bbMin?.[1])}`);
};

// ───────────────────────── сценарий ─────────────────────────

try {
  // прогрев vite (сборка зависимостей — до игроков)
  {
    const b = await launch();
    const p = await (await b.newContext()).newPage();
    try {
      await p.goto(BASE, { timeout: 180000 });
      await p.getByRole('button', { name: '3D', exact: true }).click({ timeout: 180000 });
      await p.waitForTimeout(4000);
    } catch {}
    await b.close();
  }
  note('прогрев готов');
  const [A, B] = await Promise.all([player('A'), player('B')]);
  await A.getByRole('button', { name: 'Подключить онлайн' }).click({ timeout: 120000 });
  await A.getByRole('button', { name: 'Создать лобби' }).click({ timeout: 120000 });
  await online(A);
  const code = await A.locator('input.coop-code').inputValue();
  await A.getByRole('button', { name: 'Играть' }).click({ timeout: 120000 });
  await B.getByRole('button', { name: 'Подключить онлайн' }).click({ timeout: 120000 });
  await B.locator('input.coop-code').fill(code, { timeout: 120000 });
  await B.getByRole('button', { name: 'Подключиться' }).click({ timeout: 120000 });
  await online(B);
  await B.getByRole('button', { name: 'Играть' }).click({ timeout: 120000 });
  // фонари — в пустую ячейку (луч в лицо мешает судить о модели; фонарь — п. 6)
  for (const pg of [A, B]) {
    await focus(pg);
    await pg.keyboard.press('Digit2');
  }
  await Promise.all([A, B].map((pg) => pg.waitForFunction(() => window.__rfCoop.presence.shown[0]?.clips, null, { timeout: 60000 })));
  const slots = await Promise.all([A, B].map((pg) => pg.evaluate(() => [...window.__rfCoop.co.players.values()].map((p) => `${p.name}:slot ${p.slot}`).join(', '))));
  note(`в лобби; места: A видит ${slots[0]} · B видит ${slots[1]}`);
  ok('места в лобби: B — второй (slot 1), A — первый (slot 0)', /B:slot 1/.test(slots[0]) && /A:slot 0/.test(slots[1]), `${slots[0]} / ${slots[1]}`);

  // ── комната и места ──
  const pick = await A.evaluate(PICK);
  note(`комнаты квартиры: ${pick.rooms.join(' ')}`);
  if (!pick.best) throw new Error('нет комнаты с путём 2 м и местом для A в 1 м сбоку');
  const G = pick.best;
  note(`комната ${G.room} (поиск ${pick.ms.toFixed(0)} мс): путь B ${G.b0.map((x) => x.toFixed(2))} → ${G.b1.map((x) => x.toFixed(2))} (${G.len.toFixed(1)} м), A ${G.a.map((x) => x.toFixed(2))} — до пути ${G.dmin.toFixed(1)} м, до его середины ${G.dmid.toFixed(1)} м`);
  await Promise.all([goTo(A, G.room), goTo(B, G.room)]);
  // Babylon: z = −y плана
  const bz = (p) => [p[0], -p[1]];
  const PB0 = bz(G.b0), PB1 = bz(G.b1), PA = bz(G.a);
  const PBM = [(PB0[0] + PB1[0]) / 2, (PB0[1] + PB1[1]) / 2];

  // ═════════ 1. стоят лицом друг к другу ═════════
  await aim(B, PBM[0], PBM[1], PA[0], null, PA[1]);
  await aim(A, PA[0], PA[1], PBM[0], null, PBM[1]);
  await A.waitForTimeout(1500);
  const feetA = (await me(A)).feet, feetB = (await me(B)).feet;
  // взгляд — чуть выше середины тела напарника (в кадре и ноги, и табличка)
  await aim(A, PA[0], PA[1], PBM[0], feetB + 1.15, PBM[1]);
  await aim(B, PBM[0], PBM[1], PA[0], feetA + 1.15, PA[1]);
  await A.waitForTimeout(2000);
  const meA = await me(A), meB = await me(B);
  const c1A = await capture(A, '1-A-sees-B-idle.png');
  const c1B = await capture(B, '1-B-sees-A-idle.png');
  await A.screenshot({ path: out + PFX + '1-A-sees-B-idle-hud.png' });
  for (const [who, cap, other] of [['A видит B', c1A, meB], ['B видит A', c1B, meA]]) {
    const m = cap.info, md = m?.model;
    note(`${who}: shown ${JSON.stringify(m?.shown)}`);
    note(`${who}: модель ${JSON.stringify(md && { layer: md.layer.toString(16), height: md.height, bbMin: md.bbMin, bbMax: md.bbMax, root: md.root, headAboveFeet: md.headAboveFeet, hands: [md.handRUp, md.handLUp, md.handRSide, md.handLSide], feet: [md.footLUp, md.footRUp], rootYaw: md.rootYaw, squash: md.squash, scr: md.scr })}`);
    note(`${who}: табличка ${JSON.stringify(m?.label)}; его ноги (по его камере) ${f3(other.feet)}, его yaw ${f3(other.yaw)}`);
    ok(`${who}: модель видна (shown, 8 мешей включены)`, m?.shown && md?.enabled && md.meshesEnabled === md.meshes, `${md?.meshesEnabled}/${md?.meshes} мешей`);
    ok(`${who}: ноги на полу (низ габарита со скелетом у ног игрока, ±5 см)`, md && Math.abs(md.bbMin[1] - other.feet) < 0.05, `низ ${f3(md?.bbMin[1])}, ноги ${f3(other.feet)}, Δ ${f3(md && md.bbMin[1] - other.feet)} м`);
    ok(`${who}: рост модели стоя 1.8–2.1 м`, md && md.height > 1.8 && md.height < 2.1, `${f3(md?.height)} м`);
    ok(`${who}: повёрнут по взгляду (yaw модели = yaw игрока)`, md && Math.abs(Math.atan2(Math.sin(md.rootYaw - other.yaw), Math.cos(md.rootYaw - other.yaw))) < 0.05, `модель ${f3(md?.rootYaw)} · игрок ${f3(other.yaw)}`);
    ok(`${who}: правая кисть справа (не зеркально)`, md && md.handRSide > 0.15 && md.handLSide < -0.15, `R ${f3(md?.handRSide)} L ${f3(md?.handLSide)}`);
    ok(`${who}: табличка над головой (низ таблички выше верха модели) и в кадре`, md && m.label.on && m.label.pos[1] - 0.1 > md.bbMax[1] && m.label.scr && m.label.scr[1] > 0.02, `табличка ${f3(m?.label.pos[1])} (низ ${f3(m && m.label.pos[1] - 0.1)}), верх модели ${f3(md?.bbMax[1])}, на экране y ${m?.label.scr?.[1]}`);
    ok(`${who}: не поза покоя (кисти опущены < 1.2 м над ногами, скиннинг не тождественный)`, md && md.handRUp < 1.2 && md.handLUp < 1.2 && !md.skIdentity, `кисти R ${f3(md?.handRUp)} L ${f3(md?.handLUp)} м`);
    // яркость: модель против фона (п. 5)
    const s = md?.scr;
    if (s?.head && s?.feet) {
      const cx = (s.head[0] + s.feet[0]) / 2, top = s.top?.[1] ?? s.head[1], bot = s.feet[1], hh = bot - top;
      const body = await lumaRect(cap.png, [cx - hh * 0.1, top + hh * 0.2, cx + hh * 0.1, top + hh * 0.6]);
      const bgL = await lumaRect(cap.png, [cx - hh * 0.7, top + hh * 0.2, cx - hh * 0.45, top + hh * 0.6]);
      const bgR = await lumaRect(cap.png, [cx + hh * 0.45, top + hh * 0.2, cx + hh * 0.7, top + hh * 0.6]);
      note(`${who}: яркость (0…255) — тело ${body}, фон слева ${bgL}, справа ${bgR}; модель на экране: верх ${f2(top)} низ ${f2(bot)}`);
      ok(`${who}: модель читается (яркость тела > 35/255)`, body > 35, `тело ${body}`);
    }
  }
  const coatAB = c1A.info?.shown?.coat, coatBA = c1B.info?.shown?.coat;
  ok('шинель: у A на B (место 1) ≠ у B на A (место 0)', coatAB && coatBA && coatAB !== coatBA, `A видит B: ${coatAB} · B видит A: ${coatBA}`);
  const cAB = await colorAt(c1A.png, c1A.info?.model?.scr.chest, 12), cBA = await colorAt(c1B.png, c1B.info?.model?.scr.chest, 12);
  const warm = (c) => c && c[0] - c[2]; // «бурость»: R − B
  ok('шинель B на кадре бурее (R−B пикселя груди больше на 8+), чем шинель A', cAB && cBA && warm(cAB) > warm(cBA) + 8, `грудь B на кадре A rgb(${cAB}) R−B ${warm(cAB)} · грудь A на кадре B rgb(${cBA}) R−B ${warm(cBA)}`);

  // ═════════ 4а. портальный рендер: кости двигаются в стойке ═════════
  {
    const s0 = (await mate(A))?.model;
    await A.waitForTimeout(700);
    const s1 = (await mate(A))?.model;
    ok('портальный рендер: в стойке скелет дышит (матрицы костей меняются)', s0 && s1 && s0.skSum !== s1.skSum && !s1.skIdentity, `Σ|m| ${f3(s0?.skSum)} → ${f3(s1?.skSum)}`);
  }

  // ═════════ 2. B идёт (W) ═════════
  await aim(A, PA[0], PA[1], PBM[0], feetB + 1.0, PBM[1]);
  await aim(B, PB0[0], PB0[1], PB1[0], null, PB1[1]);
  await A.waitForTimeout(1500);
  await capture(A, '2a-A-sees-B-before-walk.png');
  const w = await walk(B, A, PB0, PB1, { file: '2-A-sees-B-walking.png' });
  walkNote('ход', w);
  ok('B идёт: у A клип Walk главный (на отрезке хода)', w.clips && w.clips.Walk > 0.6, JSON.stringify(w.clips));
  ok('на ходу ноги шагают (стопы разносятся вперёд-назад > 0.15 м)', w.footMax > 0.15, `${f3(w.footMax)} м`);
  ok('кадр на ходу: Walk и ноги не в покое', w.cap?.info?.shown?.clips?.Walk > 0.5 && Math.abs(w.cap?.info?.model?.footFwdDiff ?? 0) > 0.05, `клипы ${JSON.stringify(w.cap?.info?.shown?.clips)}, стопы ${f3(w.cap?.info?.model?.footFwdDiff)}`);
  ok('кадр на ходу: ноги на полу (низ ±6 см)', w.cap?.info?.model && Math.abs(w.cap.info.model.bbMin[1] - feetB) < 0.06, `низ ${f3(w.cap?.info?.model?.bbMin[1])}, ноги ${f3(feetB)}`);
  ok('после остановки — снова стойка', w.last?.Idle_Standing > 0.6, JSON.stringify(w.last));

  // ═════════ 3. B — C: на четвереньки; ползёт ═════════
  await aim(B, PB0[0], PB0[1], PB1[0], null, PB1[1]);
  await focus(B);
  await B.keyboard.press('KeyC');
  await B.waitForFunction(() => window.__rfViewer.posture.eye < 0.62, null, { timeout: 15000 }).catch(() => {});
  await B.waitForTimeout(1200);
  const meB3 = await me(B);
  note(`B после C: поза ${meB3.pose}${meB3.flat ? ' (лёжа)' : ''}, глаз ${f3(meB3.eye)}`);
  ok('C — на четвереньки (posture.toggle: stand → crawl)', meB3.pose === 'crawl', meB3.pose);
  // A — спереди-сбоку
  await aim(A, PA[0], PA[1], PB0[0], meB3.feet + 0.35, PB0[1]);
  await A.waitForFunction(() => (window.__qaMate(true)?.state?.eye ?? 9) < 0.7, null, { timeout: 15000 }).catch(() => {});
  await A.waitForTimeout(1500);
  const c3 = await capture(A, '3-A-sees-B-crawl-idle.png');
  const md3 = c3.info?.model;
  note(`ползком на месте: клипы ${JSON.stringify(c3.info?.shown?.clips)}; модель ${JSON.stringify(md3 && { height: md3.height, bbMin: md3.bbMin, bbMax: md3.bbMax, meshMin: md3.meshMin, headFwd: md3.headFwd, headAboveFeet: md3.headAboveFeet, squash: md3.squash, boneY: md3.boneY })}`);
  ok('ползком: клип Idle_Crawl главный', c3.info?.shown?.clips?.Idle_Crawl > 0.7, JSON.stringify(c3.info?.shown?.clips));
  ok('ползком: голова вперёд по взгляду (> 0.2 м от корня) и у глаз B (±6 см)', md3 && md3.headFwd > 0.2 && Math.abs(md3.headAboveFeet - meB3.eye) < 0.06, `вперёд ${f3(md3?.headFwd)}, над ногами ${f3(md3?.headAboveFeet)} (глаз B ${f3(meB3.eye)})`);
  ok('ползком: кисти у пола (< 0.1 м)', md3 && md3.handRUp < 0.1 && md3.handLUp < 0.1, `R ${f3(md3?.handRUp)} L ${f3(md3?.handLUp)}`);
  ok('ползком: ничего не уходит под пол глубже 3 см (низ габарита со скелетом)', md3 && md3.bbMin[1] > meB3.feet - 0.03, `низ ${f3(md3?.bbMin[1])}, ноги ${f3(meB3.feet)}, Δ ${f3(md3 && md3.bbMin[1] - meB3.feet)} м; ниже ног: ${md3?.meshMin.filter((x) => x[1] < -0.01).map((x) => `${x[0]} ${x[1]}`).join(', ')}`);
  /** Сбоку у пола: A ползком (C), в 1.3 м сбоку от B напротив точки behind м позади его глаз (видно, уходит ли что-то
   *  под пол), потом встаёт (C). */
  const sideLow = async (file, behind) => {
    const ux = (PB1[0] - PB0[0]) / G.len, uz = (PB1[1] - PB0[1]) / G.len;
    const nx = -uz, nz = ux;
    // сторона — к месту A (там свободно)
    const sgn = Math.sign((PA[0] - PB0[0]) * nx + (PA[1] - PB0[1]) * nz) || 1;
    const tx = PB0[0] - ux * behind, tz = PB0[1] - uz * behind;
    await focus(A);
    await A.keyboard.press('KeyC');
    await A.waitForFunction(() => window.__rfViewer.posture.eye < 0.62, null, { timeout: 15000 }).catch(() => {});
    const ma = await me(A);
    await aim(A, tx + nx * sgn * 1.3, tz + nz * sgn * 1.3, tx, ma.feet + 0.12, tz);
    await A.waitForTimeout(1500);
    const cs = await capture(A, file);
    note(`сбоку у пола (A ползком, глаз ${f3(ma.eye)}, ${behind} м позади глаз B): у A модель на экране ${JSON.stringify(cs.info?.model?.scr)}`);
    await A.keyboard.press('KeyC');
    await A.waitForFunction(() => window.__rfViewer.posture.eye > 1.5, null, { timeout: 15000 }).catch(() => {});
    return cs;
  };
  await sideLow('3s-A-sees-B-crawl-side-low.png', 0.55);
  // ползёт: A на своём месте
  await aim(A, PA[0], PA[1], PBM[0], meB3.feet + 0.35, PBM[1]);
  await A.waitForTimeout(1200);
  const c = await walk(B, A, PB0, PB1, { file: '3b-A-sees-B-crawling.png', clip: 'Crawl', maxMs: 12000, shotAt: 0.4, stopAt: 0.85 });
  walkNote('ползком', c);
  ok('ползёт: у A клип Crawl главный', c.clips && c.clips.Crawl > 0.5, JSON.stringify(c.clips));
  ok('кадр ползком на ходу: Crawl, голова вперёд, кисти у пола', c.cap?.info?.shown?.clips?.Crawl > 0.5 && c.cap.info.model.headFwd > 0.2, `клипы ${JSON.stringify(c.cap?.info?.shown?.clips)}, голова вперёд ${f3(c.cap?.info?.model?.headFwd)}, кисти R ${f3(c.cap?.info?.model?.handRUp)} L ${f3(c.cap?.info?.model?.handLUp)}`);
  // скрючившись (C туда не ведёт — только через posture.set; переходы стоя ↔ ползком проходят эти высоты глаза)
  await aim(B, PB0[0], PB0[1], PB1[0], null, PB1[1]);
  await B.evaluate(() => window.__rfViewer.posture.set('crouch'));
  await B.waitForFunction(() => Math.abs(window.__rfViewer.posture.eye - 1.1) < 0.02, null, { timeout: 15000 }).catch(() => {});
  const meB3c = await me(B);
  await aim(A, PA[0], PA[1], meB3c.x, meB3c.feet + 0.7, meB3c.z);
  await A.waitForFunction((e) => Math.abs((window.__qaMate(true)?.state?.eye ?? 0) - e) < 0.03, meB3c.eye, { timeout: 15000 }).catch(() => {});
  await A.waitForTimeout(1500);
  const c3c = await capture(A, '3c-A-sees-B-crouch.png');
  const mdc = c3c.info?.model;
  note(`скрючившись (posture.set): поза ${meB3c.pose}, глаз ${f3(meB3c.eye)}, клипы ${JSON.stringify(c3c.info?.shown?.clips)}, ${JSON.stringify(mdc && { height: mdc.height, bbMin: mdc.bbMin[1], headAboveFeet: mdc.headAboveFeet, squash: mdc.squash, meshMin: mdc.meshMin, boneY: mdc.boneY })}`);
  ok('скрючившись: ничего не уходит под пол глубже 3 см', mdc && mdc.bbMin[1] > meB3c.feet - 0.03, `низ ${f3(mdc?.bbMin[1])}, ноги ${f3(meB3c.feet)}, Δ ${f3(mdc && mdc.bbMin[1] - meB3c.feet)} м`);
  ok('скрючившись: голова у глаз (±6 см)', mdc && Math.abs(mdc.headAboveFeet - meB3c.eye) < 0.06, `голова ${f3(mdc?.headAboveFeet)}, глаз ${f3(meB3c.eye)}`);
  await sideLow('3d-A-sees-B-crouch-side-low.png', 0.3);
  await B.evaluate(() => window.__rfViewer.posture.set('stand'));
  await B.waitForFunction(() => window.__rfViewer.posture.eye > 1.55, null, { timeout: 15000 }).catch(() => {});

  // ═════════ 4б. за проёмом: B в соседней комнате, A смотрит сквозь проём ═════════
  {
    const dws = await A.evaluate(DOORWAYS, G.room);
    note(`проёмы ${G.room}: ${dws.map((q) => `${q.to}(A в ${q.k?.toFixed(1) ?? '—'} м)`).join(' ')}`);
    const q = dws.find((x) => x.k);
    if (!q) ok('есть проём, напротив которого может встать A', false);
    else {
      const [cx, , cz] = q.c, [ux, uz] = q.u;
      // B — перед проёмом, лицом в него; проходит его, зажав W
      await aim(B, cx - ux * 0.6, cz - uz * 0.6, cx + ux * 3, null, cz + uz * 3);
      await B.waitForTimeout(600);
      await focus(B);
      await B.keyboard.down('KeyW');
      for (let k = 0; k < 80; k++) {
        await sleep(60);
        const pos = await me(B);
        if ((pos.x - cx) * ux + (pos.z - cz) * uz > 1.1) break;
      }
      await B.keyboard.up('KeyW');
      await B.waitForTimeout(900);
      let mb = await me(B);
      const walked = mb.room === q.to;
      if (!walked) {
        note(`B не прошёл проём ходом (комната ${mb.room}, нужна ${q.to}) — переношу goTo`);
        await goTo(B, q.to);
        await aim(B, cx + ux * 1.2, cz + uz * 1.2, cx + ux * 3, null, cz + uz * 3);
        await B.waitForTimeout(500);
        mb = await me(B);
      }
      // B оборачивается к проёму
      await turn(B, Math.atan2(cx - mb.x, cz - mb.z), 0.04);
      await aim(A, cx - ux * q.k, cz - uz * q.k, mb.x, mb.feet + 1.1, mb.z);
      await A.waitForTimeout(2000);
      const ma = await me(A);
      const c4 = await capture(A, '4-A-sees-B-through-doorway.png');
      const m4 = c4.info;
      const chest4 = await colorAt(c4.png, m4?.model?.scr.chest, 10);
      note(`проём в ${q.to}: B ${walked ? 'прошёл ходом' : 'перенесён'}, в ${mb.room} (${f2((mb.x - cx) * ux + (mb.z - cz) * uz)} м за проёмом), A в ${ma.room} (${q.k.toFixed(1)} м до проёма); у A: shown ${JSON.stringify(m4?.shown && { room: m4.shown.room, clips: m4.shown.clips })}, низ ${f3(m4?.model?.bbMin[1])}, ноги B ${f3(mb.feet)}, экран ${JSON.stringify(m4?.model?.scr)}, пиксель груди rgb(${chest4})`);
      ok('B в соседней комнате, A видит его сквозь проём (shown, модель включена)', mb.room === q.to && ma.room === G.room && m4?.shown && m4.model?.enabled, `B ${mb.room} · A ${ma.room}`);
      // B идёт к проёму (W) — кадр на ходу за проёмом
      const back = [cx + ux * 0.3, cz + uz * 0.3];
      if (Math.hypot(mb.x - back[0], mb.z - back[1]) > 0.6) {
        const wd = await walk(B, A, [mb.x, mb.z], back, { file: '4b-A-sees-B-walking-through-doorway.png', shotAt: 0.35, stopAt: 0.8, tries: 2, look: () => aim(A, cx - ux * q.k, cz - uz * q.k, mb.x, mb.feet + 1.1, mb.z) });
        note(`за проёмом на ходу: клипы кадра ${JSON.stringify(wd.cap?.info?.shown?.clips)}, стопы ${f3(wd.cap?.info?.model?.footFwdDiff)}, shown ${!!wd.cap?.info?.shown}`);
      }
      await goTo(B, G.room);
    }
  }

  // ═════════ 4в. рендер «набор (PVS)» у A ═════════
  {
    await A.evaluate(() => window.__rf3dFold.setRender('pvs'));
    await A.waitForTimeout(2500);
    if ((await me(A)).room !== G.room) await goTo(A, G.room);
    await aim(B, PB0[0], PB0[1], PB1[0], null, PB1[1]);
    await aim(A, PA[0], PA[1], PBM[0], feetB + 1.0, PBM[1]);
    await A.waitForTimeout(1800);
    const s0 = await mate(A);
    await A.waitForTimeout(700);
    const s1 = await mate(A);
    const portalOn = await A.evaluate(() => !!window.__rf3dFold.portal?.isActive);
    await capture(A, '4c-A-sees-B-pvs-idle.png');
    note(`PVS: портал ${portalOn ? 'вкл' : 'выкл'}, shown ${JSON.stringify(s1?.shown && { room: s1.shown.room, clips: s1.shown.clips })}, слой ${s1?.model?.layer?.toString(16)}, низ ${f3(s1?.model?.bbMin[1])}`);
    ok('PVS: модель видна (shown) и дышит (матрицы костей меняются)', !portalOn && s1?.shown && s1.model?.enabled && s0?.model?.skSum !== s1?.model?.skSum, `Σ|m| ${f3(s0?.model?.skSum)} → ${f3(s1?.model?.skSum)}`);
    const wp = await walk(B, A, PB0, PB1, { file: '4d-A-sees-B-pvs-walking.png' });
    walkNote('PVS ход', wp);
    ok('PVS: на ходу клип Walk и ноги шагают', (wp.clips?.Walk ?? 0) > 0.6 && wp.footMax > 0.15 && wp.cap?.info?.shown?.clips?.Walk > 0.5, `Walk ${wp.clips?.Walk}, размах стоп ${f3(wp.footMax)}, кадр ${JSON.stringify(wp.cap?.info?.shown?.clips)}`);
    await A.evaluate(() => window.__rf3dFold.setRender('portal'));
    await A.waitForTimeout(2000);
    if ((await me(A)).room !== G.room) await goTo(A, G.room);
  }

  // ═════════ 6. фонарик B ═════════
  {
    // B посреди пути смотрит вниз-вперёд, A — спереди-справа от него (видна правая рука и пятно луча)
    await aim(B, PBM[0], PBM[1], PA[0], null, PA[1]);
    const yawToA = Math.atan2(PA[0] - PBM[0], PA[1] - PBM[1]);
    await turn(B, yawToA - 0.75, 0.35);
    await focus(B);
    await B.keyboard.press('Digit1');
    await A.waitForFunction(() => window.__qaMate(true)?.state?.torch === 1, null, { timeout: 20000 }).catch(() => {});
    const mB6 = await me(B);
    await aim(A, PA[0], PA[1], PBM[0], mB6.feet + 0.9, PBM[1]);
    await A.waitForTimeout(2000);
    const c6 = await capture(A, '6-A-sees-B-flashlight.png');
    const t = c6.info?.torch;
    note(`фонарь: torch=${c6.info?.state?.torch}, ${JSON.stringify(t)}`);
    const dot = t ? t.dir[0] * t.gaze[0] + t.dir[1] * t.gaze[1] + t.dir[2] * t.gaze[2] : 0;
    ok('фонарь B: у A модель в правой кисти (ближе 0.12 м), свет горит', c6.info?.state?.torch === 1 && t?.model && t.light && t.distToHandR < 0.12, `до кисти R ${f3(t?.distToHandR)} м, L ${f3(t?.distToHandL)} м, сила ${t?.intensity}`);
    ok('фонарь B: луч по взгляду (cos > 0.99)', t && dot > 0.99, `cos ${f3(dot)}`);
    // ползком с фонарём
    await focus(B);
    await B.keyboard.press('KeyC');
    await A.waitForFunction(() => (window.__qaMate(true)?.state?.eye ?? 9) < 0.7, null, { timeout: 15000 }).catch(() => {});
    await A.waitForTimeout(1200);
    await aim(A, PA[0], PA[1], PBM[0], mB6.feet + 0.3, PBM[1]);
    await A.waitForTimeout(1200);
    const c6c = await capture(A, '6c-A-sees-B-flashlight-crawl.png');
    const tc = c6c.info?.torch;
    const dotc = tc ? tc.dir[0] * tc.gaze[0] + tc.dir[1] * tc.gaze[1] + tc.dir[2] * tc.gaze[2] : 0;
    note(`фонарь ползком: ${JSON.stringify(tc && { pos: tc.pos, distToHandR: tc.distToHandR, dir: tc.dir, cos: +dotc.toFixed(3) })}`);
    ok('фонарь ползком: в правой кисти у пола, луч по взгляду', tc && tc.model && tc.distToHandR < 0.12 && dotc > 0.99, `до кисти R ${f3(tc?.distToHandR)}, cos ${f3(dotc)}`);
    await B.keyboard.press('KeyC');
    await B.keyboard.press('Digit2');
  }

  ok('без ошибок страниц', errors.length === 0, errors.slice(0, 6).join(' | '));
  note(`предупреждения страниц (${warnings.length}): ${[...new Set(warnings)].slice(0, 12).join(' | ')}`);
} catch (e) {
  console.error(e);
  ok('скрипт отработал', false, String(e?.message ?? e).slice(0, 500));
  if (errors.length) note(`ошибки страниц: ${errors.slice(0, 6).join(' | ')}`);
} finally {
  await Promise.all(browsers.map((b) => b.close().catch(() => {})));
  await server.close();
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
