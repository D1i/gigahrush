// QA коопа через мост Steam (docs/COOP.md §4) без Steam: два моста tools/steam-bridge.mjs в этом процессе — хост (хаб)
// и игрок (туннель) — связаны тестовой сетью вместо P2P Steam; данные лобби Steam (код игрового лобби) — как у хоста.
// Окна (playwright + системный Chrome, свой vite без слежения за файлами, порт 5298):
//  A: «3D» → «Подключить онлайн» → блок Steam «Вы — сервер» → «Создать лобби через Steam»;
//  B: «Подключить онлайн» → «Подключиться через Steam» (код — из моста) → оба в игре, миры одинаковы, видят друг друга;
//  в модалке A — «Steam · лобби …». Скриншоты — tools/qa/coop-steam-*.png. node tools/qa-coop-steam.mjs
import { chromium } from 'playwright-core';
import { createServer as createVite } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COOP_PROTO, createCoopHub } from './coop-server.mjs';
import { clientRelay, createLoopbackNet, createTunnelClient, createTunnelHost, hostRelay, startBridgeHttp } from './steam-bridge.mjs';

const PORT = 5298;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const results = [];
const ok = (name, cond, info = '') => {
  results.push({ name, ok: !!cond, info });
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};
const errors = [];

// ── мосты: хост (хаб + туннель) и игрок (туннель к хосту) ──
const STEAM_LOBBY = '109775241234567890';
const net = createLoopbackNet();
const hub = createCoopHub();
const lastGame = () => [...hub.lobbies.values()].sort((a, b) => b.created - a.created)[0]?.id ?? null;
const steam = (me, members) => ({ lobby: STEAM_LOBBY, me, host: 'A-steam', members, max: 4 });
const hostHttp = await startBridgeHttp({
  port: 0,
  onWs: hostRelay(hub),
  status: () => ({ app: 'room-forge-steam', v: COOP_PROTO, role: 'host', ready: true, error: null, ws: '/coop', steam: steam('A-steam', 1 + th.peers), game: { lobby: lastGame() } }),
});
const th = createTunnelHost({ transport: net.peer('H'), hub });
const tc = createTunnelClient({ transport: net.peer('B'), host: 'H' });
const clientHttp = await startBridgeHttp({
  port: 0,
  onWs: clientRelay(() => tc),
  status: () => ({ app: 'room-forge-steam', v: COOP_PROTO, role: 'client', ready: true, error: null, ws: '/coop', steam: steam('B-steam', 2), game: { lobby: lastGame() } }),
});

let serverLog = '';
const log = (m) => (serverLog += m + '\n');
const vite = await createVite({
  root: ROOT,
  server: { port: PORT, strictPort: true, watch: null },
  customLogger: { info: log, warn: log, warnOnce: log, error: log, clearScreen() {}, hasErrorLogged: () => false, hasWarned: false },
});
await vite.listen();
const BASE = `http://localhost:${PORT}/`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

/** Игрок: свой контекст, профиль с адресом своего моста, «3D» → «Прогулка». */
async function player(name, color, bridgePort) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|WebSocket|ERR_CONNECTION_REFUSED|Failed to fetch/i.test(m.text()) && errors.push(`${name} ${m.text().slice(0, 300)}`));
  await page.goto(BASE, { timeout: 180000 });
  await page.evaluate(
    ({ name, color, server }) => {
      localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-steam', deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true, on: true }));
      localStorage.setItem('room-forge/coop/profile', JSON.stringify({ name, color, server, lastLobby: '' }));
    },
    { name, color, server: `localhost:${bridgePort}` },
  );
  await page.reload({ timeout: 180000 });
  await page.getByRole('button', { name: '3D', exact: true }).click({ timeout: 180000 });
  await page.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
  return page;
}
const online = (page) => page.waitForFunction(() => window.__rfCoop?.co?.status === 'online' && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });

try {
  // прогрев (зависимости Vite — до игроков)
  {
    const ctx = await browser.newContext();
    const pg = await ctx.newPage();
    try {
      await pg.goto(BASE, { timeout: 180000 });
      await pg.evaluate(() => localStorage.setItem('room-forge/walk', JSON.stringify({ seed: 'qa-warm', clusters: true, on: true })));
      await pg.reload({ timeout: 180000 });
      await pg.getByRole('button', { name: '3D', exact: true }).click({ timeout: 180000 });
      await pg.waitForFunction(() => window.__rfWalk && window.__rf3dFold?.portal?.isActive, null, { timeout: 180000 });
      await pg.getByRole('button', { name: 'Подключить онлайн' }).click();
      await pg.waitForTimeout(3000);
    } catch {}
    await ctx.close();
  }

  const A = await player('A', '#e0563f', hostHttp.port);
  await A.getByRole('button', { name: 'Подключить онлайн' }).click();
  await A.getByText('Вы — сервер').waitFor({ timeout: 20000 });
  ok('A: блок Steam нашёл мост — «Вы — сервер», лобби Steam', (await A.locator('.coop-steam').textContent())?.includes(STEAM_LOBBY));
  await A.screenshot({ path: out + 'coop-steam-1-host.png' });
  await A.getByRole('button', { name: 'Создать лобби через Steam' }).click();
  await online(A);
  const aUrl = await A.evaluate(() => window.__rfCoop.co.url);
  ok('A в игре через свой мост (хаб хоста)', aUrl === `ws://localhost:${hostHttp.port}/coop`, aUrl);
  const steamLine = await A.locator('.coop-modal .v3-kv').first().textContent();
  ok('модалка A: «Steam · лобби …» вместо адреса', /Steam · лобби/.test(steamLine ?? ''), (steamLine ?? '').slice(0, 120));
  await A.screenshot({ path: out + 'coop-steam-2-host-lobby.png' });
  await A.getByRole('button', { name: 'Играть' }).click();

  const B = await player('B', '#4fb3e8', clientHttp.port);
  await B.getByRole('button', { name: 'Подключить онлайн' }).click();
  await B.getByRole('button', { name: 'Подключиться через Steam' }).waitFor({ timeout: 20000 });
  await B.screenshot({ path: out + 'coop-steam-3-client.png' });
  await B.getByRole('button', { name: 'Подключиться через Steam' }).click();
  await online(B);
  await B.getByRole('button', { name: 'Играть' }).click();
  const s = await Promise.all(
    [A, B].map((p) => p.evaluate(() => ({ seq: window.__rfCoop.co.lastSeq, fp: window.__rfCoop.co.walk.fingerprint(), players: [...window.__rfCoop.co.players.values()].map((x) => x.name), url: window.__rfCoop.co.url, lobby: window.__rfCoop.co.lobby }))),
  );
  ok('B подключился через туннель (свой мост → хост), лобби — то, что создал A', s[1].url === `ws://localhost:${clientHttp.port}/coop` && s[1].lobby === s[0].lobby && th.peers === 1, `${s[1].url} · ${s[1].lobby}`);
  ok('видят друг друга в списке', s[0].players.includes('B') && s[1].players.includes('A'));
  await B.waitForTimeout(1500);
  const [sa, sb] = await Promise.all([A, B].map((p) => p.evaluate(() => ({ seq: window.__rfCoop.co.lastSeq, fp: window.__rfCoop.co.walk.fingerprint(), shown: window.__rfCoop.presence.shown.length }))));
  ok('миры одинаковы', sa.seq === sb.seq && sa.fp === sb.fp, `${sa.seq}/${sb.seq}`);
  ok('аватары видны (B появился рядом с A)', sa.shown === 1 && sb.shown === 1, `A ${sa.shown} · B ${sb.shown}`);
  await B.locator('canvas').first().screenshot({ path: out + 'coop-steam-4-B-sees-A.png' });
} catch (e) {
  console.error(e);
  ok('сценарий без исключений', false, String(e?.message ?? e).slice(0, 400));
} finally {
  ok('без ошибок на страницах', errors.length === 0, errors.slice(0, 5).join(' | '));
  if (results.some((r) => !r.ok)) console.log(`\n── лог vite ──\n${serverLog.slice(-3000)}`);
  await browser.close();
  th.close();
  tc.close();
  await Promise.all([hostHttp.close(), clientHttp.close(), vite.close()]);
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} OK`);
  process.exit(bad.length ? 1 : 0);
}
