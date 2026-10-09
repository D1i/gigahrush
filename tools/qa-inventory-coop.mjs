// QA рук «Прогулки» в коопе (docs/COOP.md, src/view3d/inventory.ts): два игрока — два контекста браузера, лобби через UI,
// мир — сарай (темно). A держит горящий фонарик — у B на аватаре A фонарик и луч (PlayerState.torch); A — F — у B луч
// гаснет; A — G — фонарь на полу у обоих (операция drop); B смотрит на него — E — подобрал (операция pick): у обоих пол
// пуст, у B в хотбаре второй фонарик, у A — нет. Скриншоты — tools/qa/invco-*.png.
//   node tools/qa-inventory-coop.mjs
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5264;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.qa.config.ts', import.meta.url)),
  root: ROOT,
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-qa-inventory', import.meta.url)),
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
const COLORS = { A: '#e0563f', B: '#4fb3e8' };

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|WebSocket|ERR_CONNECTION_REFUSED/i.test(m.text()) && errors.push(`${name} ${m.text().slice(0, 300)}`));
  await page.goto(BASE, { timeout: 180000 });
  await page.evaluate(
    ({ name, color }) => {
      localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-inv-coop', deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, biome: 'barn', on: true }));
      localStorage.setItem('room-forge/coop/profile', JSON.stringify({ name, color, server: '', lastLobby: '' }));
      localStorage.setItem('room-forge/flashlight-sound', '0');
    },
    { name, color: COLORS[name] },
  );
  await page.reload({ timeout: 180000 });
  await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 180000 });
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
  return page;
}
const online = (page) => page.waitForFunction(() => window.__rfCoop?.co?.status === 'online' && window.__rf3dFold?.portal?.isActive && window.__rfInv, null, { timeout: 180000 });
/** Аватар другого игрока у меня: его фонарик (модель, луч) и флаг torch в его положении. */
const mate = (page) =>
  page.evaluate(() => {
    const p = window.__rfCoop.presence;
    const a = [...p.avatars.values()][0];
    const s = [...window.__rfCoop.co.players.values()][0]?.state;
    return { torchFlag: s?.torch ?? null, model: !!a?.torch && a.torch.m.root.isEnabled(), light: !!a?.torch && a.torch.l.isEnabled() && a.torch.l.intensity > 0.3, shown: p.shown.length };
  });
const inv = (page) =>
  page.evaluate(() => ({
    hotbar: window.__rfInv.hotbar(),
    drops: window.__rfWalk.drops().map((d) => d.id),
    aimed: window.__rfInv.aimed()?.id ?? null,
    seq: window.__rfCoop.co.lastSeq,
  }));
const place = (page, x, z, lx, lz, pitch = 0.05) =>
  page.evaluate(
    ({ x, z, lx, lz, pitch }) => {
      const c = window.__rf3d.fps;
      c.position.set(x, c.position.y, z);
      c.rotation.set(pitch, Math.atan2(lx - x, lz - z), 0);
      c.cameraDirection.setAll(0);
    },
    { x, z, lx, lz, pitch },
  );

try {
  // прогрев vite (перезагрузка после сборки зависимостей)
  {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(BASE, { timeout: 180000 });
    await p.getByRole('button', { name: '3D', exact: true }).click({ timeout: 180000 });
    await p.waitForTimeout(4000);
    await ctx.close();
  }
  const A = await player('A');
  const B = await player('B');
  await A.getByRole('button', { name: 'Подключить онлайн' }).click();
  await A.getByRole('button', { name: 'Создать лобби' }).click();
  await online(A);
  const code = await A.locator('input.coop-code').inputValue();
  await A.getByRole('button', { name: 'Играть' }).click();
  await B.getByRole('button', { name: 'Подключить онлайн' }).click();
  await B.locator('input.coop-code').fill(code);
  await B.getByRole('button', { name: 'Подключиться' }).click();
  await online(B);
  await B.getByRole('button', { name: 'Играть' }).click();
  await B.waitForTimeout(1500);
  // в одной комнате, лицом друг к другу, 2.5 м
  const r = await A.evaluate(() => {
    const d = window.__rf3dFold;
    const room = d.portal.current;
    const piece = d.portal.cache.peek(room);
    let best = null;
    for (const q of piece?.floor ?? []) {
      const len = Math.max(q.x1 - q.x0, q.y1 - q.y0);
      if (!best || len > best.len) best = { ...q, len };
    }
    return best;
  });
  const alongX = r.x1 - r.x0 >= r.y1 - r.y0;
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  const half = Math.max(0.6, Math.min(1.3, (alongX ? r.x1 - r.x0 : r.y1 - r.y0) / 2 - 0.35));
  const pa = alongX ? [cx - half, -cy] : [cx, -(cy - half)];
  const pb = alongX ? [cx + half, -cy] : [cx, -(cy + half)];
  await place(A, pa[0], pa[1], pb[0], pb[1]);
  await place(B, pb[0], pb[1], pa[0], pa[1]);
  // B свой фонарь — в пустую ячейку (в кадре — только луч A)
  await B.locator('.v3-stage canvas').click({ position: { x: 200, y: 200 } });
  await B.keyboard.press('Digit2');
  await A.waitForTimeout(1500);
  const m1 = await mate(B);
  await B.screenshot({ path: out + 'invco-1-B-sees-A-torch.png' });
  ok('у B: на аватаре A фонарик и луч (torch)', m1.torchFlag === 1 && m1.model && m1.light && m1.shown === 1, JSON.stringify(m1));
  await A.locator('.v3-stage canvas').click({ position: { x: 200, y: 200 } });
  await A.keyboard.press('KeyF');
  await B.waitForTimeout(1200);
  const m2 = await mate(B);
  await B.screenshot({ path: out + 'invco-2-B-sees-A-dark.png' });
  ok('A — F: у B луч A погас', m2.torchFlag == null && !m2.model && !m2.light, JSON.stringify(m2));
  // A бросает фонарь под ноги в сторону B
  await place(A, pa[0], pa[1], pb[0], pb[1], 0.5);
  await A.keyboard.press('KeyG');
  await A.waitForTimeout(1500);
  const ia = await inv(A), ib = await inv(B);
  ok('A — G: фонарь на полу у обоих (drop через лобби)', ia.drops.length === 1 && ib.drops.length === 1 && ia.drops[0] === ib.drops[0] && !ia.hotbar.slots[0], `A ${ia.drops} · B ${ib.drops}`);
  // B подходит и смотрит на него
  const d = await B.evaluate(() => window.__rfWalk.drops()[0]);
  await place(B, d.x + (pb[0] - pa[0]) * 0.3, d.z + (pb[1] - pa[1]) * 0.3, d.x, d.z, 0.85);
  await B.waitForTimeout(1200);
  const ib2 = await inv(B);
  await B.screenshot({ path: out + 'invco-3-B-at-drop.png' });
  ok('у B: брошенный A фонарь подсвечен', ib2.aimed === d.id, String(ib2.aimed));
  await B.keyboard.press('KeyE');
  await B.waitForTimeout(1500);
  const ia3 = await inv(A), ib3 = await inv(B);
  ok('B — E: подобрал (pick через лобби) — у обоих пол пуст, у B второй фонарик', ia3.drops.length === 0 && ib3.drops.length === 0 && ib3.hotbar.slots.filter((s) => s?.item === 'it_flashlight').length === 2 && !ia3.hotbar.slots[0], JSON.stringify(ib3.hotbar));
  ok('миры одинаковы (seq)', ia3.seq === ib3.seq, `${ia3.seq}/${ib3.seq}`);
  ok('без ошибок страниц', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) {
  console.error(e);
  ok('скрипт отработал', false, String(e?.message ?? e));
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
