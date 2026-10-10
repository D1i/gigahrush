// QA метро: «проходы с невидимыми стенами» (жалоба заказчика). В сгенерированном мире метро (несколько сидов, ~300
// комнат) игрок проходит каждый проём между экземплярами метро и каждую комнату насквозь — там, где проход виден, он
// должен быть и проходим. Ходьба — синхронной симуляцией кадра (как в игре, без отрисовки): сдвиг камеры с коллизиями
// Babylon (FreeCamera._collideWithWorld — тот же эллипсоид 0.3 × 0.85, та же гравитация), опора лестницы
// (StairSupport), смена текущей комнаты и набор коллизий портального рендера (PortalRenderer.track /
// updateCollisions). Упёрся — что держит: пробный сдвиг (collider.collidedMesh) + лучи вперёд по коллайдерам и по
// ВИДИМЫМ мешам (стены, модели предметов, меши эскалатора): если видимое препятствие дальше, чем упёрлись, —
// «невидимая стена».
//  links — каждый связанный проём (run.links, обе стороны — метро; шов бесконечного хода тоже): с ~1.5 м перед
//          проёмом лицом к нему (по ширине — несколько точек), идти до ~0.9 м за проём; прошёл — текущая комната сменилась;
//  rooms — каждая комната метро (по экземпляру на вид): прямые проходы вдоль и поперёк через 0.3 м (между пилонами и
//          платформой, вдоль платформ, мини/микро-станции, вестибюль к выходам…); упёрся в невидимое — в отчёт;
//  esc   — эскалатор: каждая целая дорожка снизу вверх и сверху вниз.
// Итог — лог, tmp/metro-wip/passages-<сид>.json и таблица tmp/metro-wip/passages-last.md.
//   node tools/qa-metro-passages.mjs           QA_SEEDS=a,b  QA_N=300  QA_ONLY=links,rooms,esc  QA_SHOTS=1 (снимки находок)
// Свой vite (порт 5293, свой cacheDir — не мешает dev-серверам других сессий).
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.QA_PORT) || 5293;
const SEEDS = (process.env.QA_SEEDS || 'qa-pass-1,qa-pass-2,qa-pass-3').split(',').filter(Boolean);
const N = Number(process.env.QA_N) || 300;
const ONLY = (process.env.QA_ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const SHOTS = process.env.QA_SHOTS === '1';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('../tmp/metro-wip/', import.meta.url));
mkdirSync(OUT + 'shots', { recursive: true });

const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.qa.config.ts', import.meta.url)),
  root: ROOT,
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-qa-passages', import.meta.url)),
  server: { port: PORT, strictPort: true },
  logLevel: 'warn',
});
await server.listen();
const BASE = `http://localhost:${PORT}/`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

// ───────────────────────── в странице: симуляция шага и диагностика ─────────────────────────

/** Ставит window.__pq — помощники в странице (без замыканий Node: функция сериализуется целиком). */
const LIB = () => {
  const v = window.__rf3d, d = window.__rf3dFold, S = window.__rfWalk;
  const cam = v.fps;
  const V3 = cam.position.constructor;
  const Ray = v.posture.hray.constructor;
  const P = () => d.portal;
  const cur = () => d.portal?.current ?? d.current.center;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** радиус капсулы игрока и запас при поиске свободного места, м */
  const R = 0.3, PAD = 0.32;
  const inst = (id) => S.rx.instances.find((i) => i.id === id) ?? null;
  const roomOf = (id) => inst(id)?.roomId ?? '?';
  const isMetro = (i) => i?.roomTags?.[0] === 'метро';

  const inRects = (rs, x, y) => rs.some((r) => x >= r.x0 - 1e-6 && x <= r.x1 + 1e-6 && y >= r.y0 - 1e-6 && y <= r.y1 + 1e-6);
  const K = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
  /** капсула в точке плана целиком над полом прямоугольников rs */
  const fits = (rs, x, y, r = PAD) => K.every(([a, b]) => inRects(rs, x + a * r, y + b * r));
  /** точка внутри плана предмета (повёрнутого), с запасом pad */
  const inProp = (p, x, y, pad) => {
    const a = ((p.rot || 0) * Math.PI) / 180, dx = x - p.x, dy = y - p.y;
    const lx = dx * Math.cos(a) + dy * Math.sin(a), ly = -dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(lx) <= p.w / 2 + pad && Math.abs(ly) <= p.d / 2 + pad;
  };
  /** предметы куска с настоящим коллайдером (не плоские и не подвесные) */
  const solidProps = (piece) => piece.model.props.filter((p) => p.h > 0.05);
  const propFree = (piece, x, y, r = PAD) => !solidProps(piece).some((p) => inProp(p, x, y, r));
  /** капсула стоит целиком на марше или целиком мимо (не на краю марша и не в щели между маршами) */
  const stairClean = (piece, x, y, r = PAD) => {
    // пандус-коллайдер марша начинается на проступь (~0.27 м) раньше прямоугольника марша — вдоль марша с запасом 0.3
    // (поперёк — нет: щель между маршами должна остаться щелью)
    const fl = (piece.model.stairs ?? []).flatMap((g) => g.flights.map((f) => {
      const ax = f.up === 'E' || f.up === 'W' ? 0.3 : 0, ay = f.up === 'N' || f.up === 'S' ? 0.3 : 0;
      return { x0: f.rect.x0 - ax, y0: f.rect.y0 - ay, x1: f.rect.x1 + ax, y1: f.rect.y1 + ay };
    }));
    if (!fl.length) return true;
    const n = K.filter(([a, b]) => inRects(fl, x + a * r, y + b * r)).length;
    return n === 0 || n === K.length;
  };

  async function grow(n) {
    const w = S.world;
    const seen = new Set();
    const q = [w.startId];
    while (q.length && w.run().instances.length < n) {
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
    for (let k = 0; k < 60 && S.rx.instances.length < w.run().instances.length; k++) await sleep(100);
    return S.rx.instances.length;
  }

  /** Связи между экземплярами метро (проёмы): a → b и b → a. */
  function links() {
    const out = [];
    const by = new Map(S.rx.instances.map((i) => [i.id, i]));
    for (const l of S.rx.links) {
      if (l.kind === 'descent' || l.kind === 'lift' || l.sealed) continue;
      const A = by.get(l.a.inst), B = by.get(l.b.inst);
      if (!isMetro(A) || !isMetro(B)) continue;
      const tag = A.connectors.find((k) => k.id === l.a.connector)?.tag ?? '?';
      const tagB = B.connectors.find((k) => k.id === l.b.connector)?.tag ?? '?';
      out.push({ a: l.a.inst, ac: l.a.connector, b: l.b.inst, bc: l.b.connector, ra: A.roomId, rb: B.roomId, tag, tagB, wrap: !!l.wrap });
      out.push({ a: l.b.inst, ac: l.b.connector, b: l.a.inst, bc: l.a.connector, ra: B.roomId, rb: A.roomId, tag: tagB, tagB: tag, wrap: !!l.wrap });
    }
    return out;
  }

  /** Сделать комнату id текущей (как шаг на её пол: камера не трогается). */
  function enter(id) {
    if (cur() !== id) d.onPortalCross(cur(), id);
    return P().cache.get(id);
  }

  /** Обновить коллизии портала для позиции камеры (как кадр портального рендера). */
  function syncCollide() {
    const pc = P().current ? P().cache.get(P().current) : null;
    if (pc) P().updateCollisions(pc, cam.position.clone());
  }

  /** Поставить игрока стоя в точку плана (x, y) на отметку z, лицом по (dx, dy), и дать осесть. */
  function place(x, y, z, dx, dy) {
    v.posture.set('stand');
    v.posture.finish?.();
    cam.position.set(x, z + v.posture.eye + 0.05, -y);
    cam.rotation.set(0, Math.atan2(dx, -dy), 0);
    cam.cameraDirection.setAll(0);
    cam.cameraRotation.set(0, 0);
    cam.checkCollisions = true;
    syncCollide();
    for (let k = 0; k < 12; k++) step(0, 0, 0);
  }

  /**
   * Кадр игры без отрисовки: сдвиг камеры с коллизиями (гравитация — как оставила опора лестницы), поза стоя
   * (гравитация вкл.), опора марша, смена комнаты (шов — перенос камеры) и набор коллизий. → сдвиг по плану до шва.
   */
  function step(dx, dy, len) {
    const b = cam.position.clone();
    cam._collideWithWorld(new V3(dx * len, 0, -dy * len));
    const moved = { x: cam.position.x - b.x, y: -(cam.position.z - b.z), z: cam.position.y - b.y };
    cam.applyGravity = true;
    P().stairs.frame();
    const eye = cam.position.clone();
    const wrapped = P().autoTrack ? P().track(eye) : null;
    const pc = P().current ? P().cache.get(P().current) : null;
    if (pc) P().updateCollisions(pc, wrapped ? eye.subtract(wrapped) : eye);
    return moved;
  }

  /** Меши комнат с коллизиями сейчас: видимые (что видит игрок) и коллайдеры. */
  function meshSets() {
    const vis = [], col = [];
    for (const id of P().colliding) {
      const p = P().cache.peek(id);
      if (!p) continue;
      for (const m of p.bo.root.getChildMeshes(false)) {
        if (m.checkCollisions) col.push([m, id]);
        if (m.isVisible && m.isEnabled() && (m.getTotalVertices?.() ?? 0) > 0) vis.push([m, id]);
      }
      for (const f of P().extraProviders) {
        for (const m of f(id) ?? []) {
          for (const x of [m, ...m.getChildMeshes(false)]) {
            if (x.isVisible && x.isEnabled() && (x.getTotalVertices?.() ?? 0) > 0) vis.push([x, id]);
            if (x.checkCollisions) col.push([x, id]);
          }
        }
      }
    }
    return { vis, col };
  }
  /** Точка куска id за плоскостью его портала, в пределах проёма: там рисуется соседняя комната — своё не видно. */
  const behindPortal = (pt, id) => {
    const p = P().cache.peek(id);
    if (!p || !pt) return false;
    return p.portals.some((q) => {
      const s = (pt.x - q.p0.x) * q.u.x + (pt.y - q.p0.y) * q.u.y + (pt.z - q.p0.z) * q.u.z;
      if (s <= 1e-3 || s > 1.0) return false;
      const t = q.axis === 'x' ? -pt.z : pt.x;
      return t >= q.lo - 1e-3 && t <= q.hi + 1e-3 && pt.y >= q.z - 0.05 && pt.y <= q.z + q.h + 0.05;
    });
  };
  /** Ближнее попадание луча; seen — только видимое игроку (не за плоскостью портала своего куска). */
  function cast(list, o, dir, len, seen = false) {
    const ray = new Ray(o, dir, len);
    let best = null;
    for (const [m, id] of list) {
      const h = ray.intersectsMesh(m, false);
      if (!h?.hit || (best && h.distance >= best.d)) continue;
      const pt = h.pickedPoint?.clone();
      if (seen && behindPortal(pt, id)) continue;
      best = { d: h.distance, m, id, pt };
    }
    return best;
  }
  /** Что за меш: предмет / стена куска (по объёму модели) / лестница / тупик / дверь / эскалатор. */
  function describe(m, pt) {
    if (!m) return null;
    const md = m.metadata || {};
    const owner = P().colliding.find((id) => P().cache.peek(id)?.collidable.includes(m)) ?? null;
    const o = { name: m.name, kind: md.kind ?? null, owner, ownerRoom: owner ? roomOf(owner) : null };
    if (md.propId) Object.assign(o, { propId: md.propId, inst: md.inst });
    if (md.connector) o.connector = md.connector;
    if (pt && owner && /^(wall|partition|lintel|column)$/.test(md.kind ?? '')) {
      const x = pt.x, y = -pt.z;
      const s = P().cache.peek(owner).model.solids.find((s) => x >= s.rect.x0 - 0.03 && x <= s.rect.x1 + 0.03 && y >= s.rect.y0 - 0.03 && y <= s.rect.y1 + 0.03 && pt.y >= s.z0 - 0.03 && pt.y <= s.z1 + 0.03);
      if (s) o.solid = { kind: s.kind, inst: s.inst ?? null, room: s.inst ? roomOf(s.inst) : null, rect: [s.rect.x0, s.rect.y0, s.rect.x1, s.rect.y1].map((v) => +v.toFixed(2)), z: [+s.z0.toFixed(2), +s.z1.toFixed(2)] };
    }
    if (pt) o.at = [+pt.x.toFixed(2), +(-pt.z).toFixed(2), +pt.y.toFixed(2)];
    return o;
  }

  /** Почему стоим, идя по (dx, dy): пробный сдвиг без гравитации, лучи вперёд и в стороны по коллайдерам и видимому. */
  function diagnose(dx, dy) {
    const { vis, col } = meshSets();
    const pos = cam.position.clone();
    const feet = pos.y - 2 * cam.ellipsoid.y + cam.ellipsoidOffset.y;
    const D = new V3(dx, 0, -dy), Lb = new V3(-dy, 0, -dx);
    let visMin = Infinity, colMin = Infinity, visHit = null, colHit = null;
    for (const h of [0.12, 0.3, 0.42, 0.6, 0.72, 1.0, 1.3, 1.6]) {
      for (const o of [-0.29, -0.15, 0, 0.15, 0.29]) {
        const org = new V3(pos.x + Lb.x * o, feet + h, pos.z + Lb.z * o);
        const a = cast(vis, org, D, 4, true), c = cast(col, org, D, 4);
        if (a && a.d < visMin) (visMin = a.d), (visHit = a);
        if (c && c.d < colMin) (colMin = c.d), (colHit = c);
      }
    }
    const side = (s) => {
      let vMin = Infinity, cMin = Infinity, cH = null;
      for (const h of [0.3, 1.0]) {
        const org = new V3(pos.x, feet + h, pos.z);
        const dir = new V3(Lb.x * s, 0, Lb.z * s);
        const a = cast(vis, org, dir, 2, true), c = cast(col, org, dir, 2);
        if (a) vMin = Math.min(vMin, a.d);
        if (c && c.d < cMin) (cMin = c.d), (cH = c);
      }
      return { vis: vMin, col: cMin, hit: cH ? describe(cH.m, cH.pt) : null };
    };
    // пробный сдвиг: без гравитации, на 3 см выше — плоские коллайдеры пола не мешают
    const g = cam.applyGravity;
    cam.applyGravity = false;
    cam.position.y += 0.03;
    if (cam._collider) cam._collider.collidedMesh = null;
    cam._collideWithWorld(new V3(dx * 0.12, 0, -dy * 0.12));
    const pm = cam._collider?.collidedMesh ?? null;
    const ip = pm ? cam._collider.intersectionPoint : null;
    let touch = null;
    if (ip) {
      const e = cam.ellipsoid;
      const c = new V3(ip.x * e.x, ip.y * e.y, ip.z * e.z);
      const ctr = cam.position.subtract(new V3(0, e.y, 0)).add(cam.ellipsoidOffset);
      const hd = Math.hypot(c.x - ctr.x, c.z - ctr.z);
      if (hd > 1e-3) {
        const dir = new V3((c.x - ctr.x) / hd, 0, (c.z - ctr.z) / hd);
        const org = new V3(ctr.x, Math.max(c.y, feet + 0.05), ctr.z);
        const a = cast(vis, org, dir, hd + 0.6, true);
        touch = { at: [+c.x.toFixed(2), +(-c.z).toFixed(2), +c.y.toFixed(2)], d: +hd.toFixed(2), vis: a ? +a.d.toFixed(2) : null, seen: !!a && a.d <= hd + 0.2 };
      }
    }
    const pmv = cam.position.subtract(pos.add(new V3(0, 0.03, 0)));
    cam.position.copyFrom(pos);
    cam.applyGravity = g;
    const r2 = (v) => (Number.isFinite(v) ? +v.toFixed(2) : null);
    return {
      room: cur(), roomId: roomOf(cur()), at: [r2(pos.x), r2(-pos.z), r2(feet)], colliding: P().colliding.map(roomOf),
      visAhead: r2(visMin), colAhead: r2(colMin),
      visHit: visHit ? describe(visHit.m, visHit.pt) : null, colHit: colHit ? describe(colHit.m, colHit.pt) : null,
      probe: describe(pm, null), probeMoved: r2(Math.hypot(pmv.x, pmv.z)), touch,
      left: side(1), right: side(-1),
    };
  }

  /**
   * Идти по (dx, dy) от текущего места до dist м (по плану, с учётом шва) шагами len; стоп — упёрся (за 10 шагов
   * меньше 15 % пути) или упал. → { prog, stuck, fell }.
   */
  function walk(dx, dy, dist, len = 0.03, fallM = 2.5) {
    const eng = v.scene.getEngine();
    const dt0 = eng.getDeltaTime;
    eng.getDeltaTime = () => (len / 1.7) * 1000;
    try {
      return walk0(dx, dy, dist, len, fallM);
    } finally {
      eng.getDeltaTime = dt0;
    }
  }
  function walk0(dx, dy, dist, len, fallM) {
    const z0 = cam.position.y;
    let prog = 0;
    const hist = [];
    const maxN = Math.ceil(dist / len) + 40;
    for (let k = 0; k < maxN && prog < dist; k++) {
      const m = step(dx, dy, len);
      prog += m.x * dx + m.y * dy;
      hist.push(prog);
      if (cam.position.y < z0 - fallM && !P().stairs.onFlight) return { prog, stuck: false, fell: true };
      if (k >= 10 && prog - hist[k - 10] < len * 10 * 0.15) return { prog, stuck: true, fell: false };
    }
    return { prog, stuck: prog < dist - 0.02, fell: false };
  }

  /** Проём связи L: из a в b через её метку; по ширине — несколько точек. */
  function linkTest(L) {
    const pa = enter(L.a);
    if (!pa) return [{ ...L, ok: false, err: 'нет куска A' }];
    const q = pa.portals.find((q) => q.to === L.b && ((q.a.inst === L.a && q.a.connector === L.ac) || (q.b.inst === L.a && q.b.connector === L.ac)));
    if (!q) return [{ ...L, ok: false, err: 'нет портала', portals: pa.portals.map((p) => roomOf(p.to)) }];
    const pb = P().cache.get(L.b);
    const sh = q.shift ?? [0, 0];
    const w = q.hi - q.lo;
    const n = w < 1.3 ? 1 : Math.max(2, Math.ceil((w - 0.8) / 1.5) + 1);
    const ts = n === 1 ? [(q.lo + q.hi) / 2] : Array.from({ length: n }, (_, k) => q.lo + 0.4 + ((w - 0.8) * k) / (n - 1));
    const dx = q.axis === 'x' ? q.dir : 0, dy = q.axis === 'y' ? q.dir : 0;
    const out = [];
    for (const t of ts) {
      const pt = (s) => (q.axis === 'x' ? [q.at - q.dir * s, t] : [t, q.at - q.dir * s]);
      let s0 = null;
      for (const s of [1.5, 1.3, 1.1, 0.9, 0.7, 0.55]) {
        const [x, y] = pt(s);
        if (fits(pa.floor, x, y) && propFree(pa, x, y) && stairClean(pa, x, y)) {
          s0 = s;
          break;
        }
      }
      const base = { ...L, w: +w.toFixed(2), t: +t.toFixed(2), side: q.axis + (q.dir > 0 ? '+' : '-') };
      if (s0 == null) {
        out.push({ ...base, ok: true, skip: 'нет места для старта' });
        continue;
      }
      // глубина b за проёмом по её полу (у шва — в её настоящем месте)
      let dB = 0;
      for (let s = 0.4; s <= 2.0 + 1e-6; s += 0.1) {
        const [x, y] = pt(-s);
        if (!pb || !fits(pb.floor, x - sh[0], y - sh[1])) break;
        dB = s;
      }
      if (dB < 0.4) {
        out.push({ ...base, ok: true, skip: `за проёмом мало пола (${dB.toFixed(1)} м)` });
        continue;
      }
      const need = s0 + Math.min(0.9, dB - 0.1);
      enter(L.a);
      const [x, y] = pt(s0);
      place(x, y, q.z, dx, dy);
      const r = walk(dx, dy, need + 0.05);
      const ok = r.prog >= need - 0.05 && cur() === L.b && !r.fell;
      const o = { ...base, s0, need: +need.toFixed(2), prog: +r.prog.toFixed(2), end: roomOf(cur()), ok, fell: r.fell };
      if (!ok) o.diag = diagnose(dx, dy);
      out.push(o);
    }
    return out;
  }

  /**
   * Комната насквозь: прямые вдоль и поперёк через spacing м по её полу (капсула целиком над полом — пилоны и стены
   * разрывают линию), в обе стороны; предметы — препятствия на пути. Упёрся — если впереди видно свободное место
   * (видимое препятствие дальше капсулы на ≥ 0.2 м), — находка; затем — дальше по линии с первого свободного места.
   */
  function sweep(id, spacing = 0.3, len = 0.05) {
    const p = enter(id);
    if (!p) return { id, err: 'нет куска' };
    const I = inst(id);
    const z = Number(I?.z) || 0;
    const fl = p.floor;
    const bb = fl.reduce((b, r) => ({ x0: Math.min(b.x0, r.x0), y0: Math.min(b.y0, r.y0), x1: Math.max(b.x1, r.x1), y1: Math.max(b.y1, r.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    // лестничные комнаты — по полу лестницы своя отметка: такие линии пропускаем (их проходят links и esc)
    const st = p.model.stairs?.[0];
    const onStair = (x, y) => !!st && (st.flights.some((f) => x > f.rect.x0 - 0.4 && x < f.rect.x1 + 0.4 && y > f.rect.y0 - 0.4 && y < f.rect.y1 + 0.4) || st.pads.some((q) => x > q.rect.x0 - 0.4 && x < q.rect.x1 + 0.4 && y > q.rect.y0 - 0.4 && y < q.rect.y1 + 0.4));
    const found = [];
    let lines = 0, stops = 0, steps = 0;
    for (const axis of ['y', 'x']) {
      const [c0, c1] = axis === 'y' ? [bb.x0, bb.x1] : [bb.y0, bb.y1];
      const [u0, u1] = axis === 'y' ? [bb.y0, bb.y1] : [bb.x0, bb.x1];
      for (let c = c0 + PAD; c <= c1 - PAD + 1e-6; c += spacing) {
        const P2 = (u) => (axis === 'y' ? [c, u] : [u, c]);
        // отрезки линии, где капсула целиком над полом комнаты
        const segs = [];
        let a = null;
        for (let u = u0; u <= u1 + 1e-6; u += 0.05) {
          const [x, y] = P2(u);
          const okp = fits(fl, x, y) && !onStair(x, y);
          if (okp && a == null) a = u;
          if (!okp && a != null) {
            if (u - 0.05 - a > 0.6) segs.push([a, u - 0.05]);
            a = null;
          }
        }
        if (a != null && u1 - a > 0.6) segs.push([a, u1]);
        for (const [s0, s1] of segs) {
          for (const sg of [1, -1]) {
            lines++;
            const dx = axis === 'x' ? sg : 0, dy = axis === 'y' ? sg : 0;
            let u = sg > 0 ? s0 : s1;
            const end = sg > 0 ? s1 : s0;
            for (let hop = 0; hop < 20; hop++) {
              // первое свободное от предметов место по ходу
              while ((end - u) * sg > 0.3 && !propFree(p, ...P2(u))) u += 0.05 * sg;
              if ((end - u) * sg <= 0.3) break;
              enter(id);
              const [x, y] = P2(u);
              place(x, y, z, dx, dy);
              const r = walk(dx, dy, Math.abs(end - u), len);
              steps += Math.round(Math.abs(r.prog) / len);
              const at = u + r.prog * sg;
              if (r.fell) {
                found.push({ room: id, roomId: roomOf(id), axis, c: +c.toFixed(2), dir: sg, at: +at.toFixed(2), fell: true });
                break;
              }
              if (!r.stuck) break;
              stops++;
              const dg = diagnose(dx, dy);
              // видимое препятствие впереди — дальше капсулы на ≥ 0.2 м: проход виден, а не пускает
              if ((dg.visAhead ?? 9) >= R + 0.2 && !dg.touch?.seen) found.push({ room: id, roomId: roomOf(id), axis, c: +c.toFixed(2), dir: sg, at: +at.toFixed(2), diag: dg });
              u = at + 0.15 * sg;
            }
          }
        }
      }
    }
    return { id, roomId: roomOf(id), lines, stops, steps, found };
  }

  /**
   * Сквозь ряды пилонов (вырезы пола — колонны): между каждыми двумя соседними пилонами ряда — поперёк ряда, в обе
   * стороны (зал: пилоны и платформа; станция поменьше — пилоны 0.4, крошечная — 0.2 через 1.125 м, просвет 0.825).
   */
  function gapTest(id) {
    const p = enter(id);
    if (!p) return [];
    const z = Number(inst(id)?.z) || 0;
    const cols = p.model.solids.filter((s) => s.kind === 'column' && s.inst === id).map((s) => s.rect);
    const same = (a, b) => Math.abs(a - b) < 0.01;
    const out = [];
    for (const a of cols) {
      for (const b of cols) {
        const rowY = same(a.x0, b.x0) && same(a.x1, b.x1) && b.y0 > a.y1 + 1e-6;
        const rowX = same(a.y0, b.y0) && same(a.y1, b.y1) && b.x0 > a.x1 + 1e-6;
        if (!rowY && !rowX) continue;
        // соседние в ряду: между ними нет другого пилона
        if (cols.some((c) => c !== a && c !== b && (rowY ? same(c.x0, a.x0) && c.y0 >= a.y1 - 1e-6 && c.y1 <= b.y0 + 1e-6 : same(c.y0, a.y0) && c.x0 >= a.x1 - 1e-6 && c.x1 <= b.x0 + 1e-6))) continue;
        const gap = rowY ? b.y0 - a.y1 : b.x0 - a.x1;
        if (gap < 0.62 || gap > 4.5) continue;
        const mx = rowY ? (a.x0 + a.x1) / 2 : (a.x1 + b.x0) / 2, my = rowY ? (a.y1 + b.y0) / 2 : (a.y0 + a.y1) / 2;
        for (const sg of [1, -1]) {
          const dx = rowY ? sg : 0, dy = rowY ? 0 : sg;
          let s0 = null;
          for (const s of [1.2, 1.0, 0.8, 0.6]) {
            const x = mx - dx * s, y = my - dy * s;
            if (fits(p.floor, x, y) && propFree(p, x, y)) {
              s0 = s;
              break;
            }
          }
          let s1 = 0;
          for (let s = 0.4; s <= 1.2 + 1e-6; s += 0.1) {
            if (!fits(p.floor, mx + dx * s, my + dy * s) || !propFree(p, mx + dx * s, my + dy * s)) break;
            s1 = s;
          }
          if (s0 == null || s1 < 0.4) continue;
          enter(id);
          place(mx - dx * s0, my - dy * s0, z, dx, dy);
          const need = s0 + s1;
          const w = walk(dx, dy, need, 0.03);
          const o = { id, roomId: roomOf(id), gap: +gap.toFixed(2), at: [+mx.toFixed(2), +my.toFixed(2)], dir: (rowY ? 'x' : 'y') + (sg > 0 ? '+' : '-'), need: +need.toFixed(2), prog: +w.prog.toFixed(2), ok: w.prog >= need - 0.05 && !w.fell };
          if (!o.ok) o.diag = diagnose(dx, dy);
          out.push(o);
        }
      }
    }
    // между соседними предметами с коллайдером (турникет — турникет, будка — турникет…): поперёк их ряда сквозь просвет
    const box = (p) => {
      const q = ((p.rot || 0) % 180 + 180) % 180 === 90;
      const w = q ? p.d : p.w, d = q ? p.w : p.d;
      return { p, x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - d / 2, y1: p.y + d / 2 };
    };
    const bs = solidProps(p).filter((x) => ((x.rot || 0) % 90) === 0).map(box);
    for (const a of bs) {
      for (const b of bs) {
        for (const ax of ['x', 'y']) {
          // ax — по какой оси соседи (просвет вдоль ax), идти — поперёк, по другой оси
          const [a0, a1, b0] = ax === 'x' ? [a.x0, a.x1, b.x0] : [a.y0, a.y1, b.y0];
          const lo = ax === 'x' ? Math.max(a.y0, b.y0) : Math.max(a.x0, b.x0), hi = ax === 'x' ? Math.min(a.y1, b.y1) : Math.min(a.x1, b.x1);
          const gap = b0 - a1;
          if (!(gap >= 0.62 && gap <= 2.0) || hi - lo < 0.3 || a0 >= b0) continue;
          // соседи: в просвете нет третьего предмета
          const m = (a1 + b0) / 2, c = (lo + hi) / 2;
          if (bs.some((x) => x !== a && x !== b && (ax === 'x' ? x.x1 > a1 && x.x0 < b0 && x.y1 > lo && x.y0 < hi : x.y1 > a1 && x.y0 < b0 && x.x1 > lo && x.x0 < hi))) continue;
          const half = (hi - lo) / 2;
          for (const sg of [1, -1]) {
            const dx = ax === 'x' ? 0 : sg, dy = ax === 'x' ? sg : 0;
            const P2 = (s) => (ax === 'x' ? [m, c + s * sg] : [c + s * sg, m]);
            let s0 = null;
            for (const s of [half + 1.0, half + 0.8, half + 0.6, half + 0.45]) {
              const [x, y] = P2(-s);
              if (fits(p.floor, x, y) && propFree(p, x, y)) {
                s0 = s;
                break;
              }
            }
            let s1 = 0;
            for (let s = half + 0.4; s <= half + 1.0 + 1e-6; s += 0.1) {
              const [x, y] = P2(s);
              if (!fits(p.floor, x, y) || !propFree(p, x, y)) break;
              s1 = s;
            }
            if (s0 == null || s1 < half + 0.4) continue;
            enter(id);
            const [x, y] = P2(-s0);
            place(x, y, z, dx, dy);
            const need = s0 + s1;
            const w = walk(dx, dy, need, 0.03);
            const o = { id, roomId: roomOf(id), gap: +gap.toFixed(2), between: `${a.p.propId} / ${b.p.propId}`.replace(/p_metro_/g, ''), at: [+(ax === 'x' ? m : c).toFixed(2), +(ax === 'x' ? c : m).toFixed(2)], dir: (ax === 'x' ? 'y' : 'x') + (sg > 0 ? '+' : '-'), need: +need.toFixed(2), prog: +w.prog.toFixed(2), ok: w.prog >= need - 0.05 && !w.fell };
            if (!o.ok) o.diag = diagnose(dx, dy);
            out.push(o);
          }
        }
      }
    }
    return out;
  }

  /** Эскалатор: каждая дорожка (марш) снизу вверх и сверху вниз. */
  async function escTest(id) {
    const frames = async (n) => {
      for (let k = 0; k < n; k++) await new Promise((r) => requestAnimationFrame(() => r()));
    };
    const p = enter(id);
    const g = p?.model.stairs?.[0];
    if (!g) return [{ id, err: 'нет лестницы' }];
    const UP = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
    const out = [];
    for (const [k, f] of g.flights.entries()) {
      const [ux, uy] = UP[f.up];
      const r = f.rect;
      const L = ux ? r.x1 - r.x0 : r.y1 - r.y0;
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
      // низ марша — край против up
      const bot = [cx - (ux * L) / 2, cy - (uy * L) / 2], top = [cx + (ux * L) / 2, cy + (uy * L) / 2];
      for (const dirn of ['вверх', 'вниз']) {
        const upw = dirn === 'вверх';
        const [sx, sy] = upw ? [bot[0] - ux * 1.5, bot[1] - uy * 1.5] : [top[0] + ux * 1.5, top[1] + uy * 1.5];
        const dx = upw ? ux : -ux, dy = upw ? uy : -uy;
        enter(id);
        place(sx, sy, upw ? f.z0 : f.z1, dx, dy);
        // кадры игры: сцена эскалатора включает свои коллайдеры (балюстрады, завалы) у комнат с коллизиями
        await frames(3);
        place(sx, sy, upw ? f.z0 : f.z1, dx, dy);
        const need = L + 1.5 + 1.0;
        const w = walk(dx, dy, need, 0.03, 99);
        const feet = cam.position.y - 2 * cam.ellipsoid.y + cam.ellipsoidOffset.y;
        const ok = !w.fell && w.prog >= need - 0.1 && (upw ? feet >= f.z1 - 0.15 : feet <= f.z0 + 0.15);
        const o = { id, roomId: roomOf(id), lane: k, dir: dirn, len: +L.toFixed(2), prog: +w.prog.toFixed(2), feet: +feet.toFixed(2), z: [f.z0, f.z1], ok };
        if (!ok) o.diag = diagnose(dx, dy);
        out.push(o);
        // не оставлять игрока на дорожке между пачками (кадры механики эскалатора)
        place(sx, sy, upw ? f.z0 : f.z1, dx, dy);
      }
    }
    // промежутки между дорожками (0.8 м): там видна балюстрада — от 0.9 м до низа марша и до верхней площадки; внутрь неё
    // не пройти (обратная беда: видимое без коллайдера). Дальше 1.0 м от начала балюстрады — находка
    const fs = [...g.flights].sort((a, b) => (a.up === 'N' || a.up === 'S' ? a.rect.x0 - b.rect.x0 : a.rect.y0 - b.rect.y0));
    for (let k = 0; k + 1 < fs.length; k++) {
      const f = fs[k], f2 = fs[k + 1];
      const [ux, uy] = UP[f.up];
      const r = f.rect;
      const L = ux ? r.x1 - r.x0 : r.y1 - r.y0;
      const lat = ux ? (r.y1 + f2.rect.y0) / 2 : (r.x1 + f2.rect.x0) / 2;
      const gapW = ux ? f2.rect.y0 - r.y1 : f2.rect.x0 - r.x1;
      if (gapW < 0.65) continue;
      const footU = ux ? (ux > 0 ? r.x0 : r.x1) : uy > 0 ? r.y0 : r.y1;
      const sx = ux ? footU - ux * 1.5 : lat, sy = ux ? lat : footU - uy * 1.5;
      enter(id);
      place(sx, sy, f.z0, ux, uy);
      await frames(3);
      place(sx, sy, f.z0, ux, uy);
      const w = walk(ux, uy, L + 1.5, 0.03);
      // балюстрада видна с 0.6 м от старта (BAL_IN 0.9 до низа марша)
      out.push({ id, roomId: roomOf(id), lane: `${g.flights.indexOf(f)}–${g.flights.indexOf(f2)}`, dir: 'между дорожками', gap: +gapW.toFixed(2), prog: +w.prog.toFixed(2), ok: w.prog < 0.6 + 1.0, len: +L.toFixed(2), feet: 0, gapTest: true });
      place(sx, sy, f.z0, ux, uy);
    }
    return out;
  }

  /** Тот же проход настоящими кадрами (ввод → камера → поза → опора → портал), для подтверждения находки. */
  async function realWalk(x, y, z, dx, dy, dist, ms = 4000) {
    place(x, y, z, dx, dy);
    await new Promise((r) => requestAnimationFrame(() => r()));
    const t0 = performance.now();
    let prog = 0, last = cam.position.clone();
    while (performance.now() - t0 < ms && prog < dist) {
      const dt = Math.min(0.1, v.scene.getEngine().getDeltaTime() / 1000 || 1 / 60);
      cam.cameraDirection.set(dx * 1.7 * dt, 0, -dy * 1.7 * dt);
      await new Promise((r) => requestAnimationFrame(() => r()));
      const m = { x: cam.position.x - last.x, y: -(cam.position.z - last.z) };
      if (Math.hypot(m.x, m.y) < 1) prog += m.x * dx + m.y * dy;
      last = cam.position.clone();
    }
    cam.cameraDirection.setAll(0);
    return { prog: +prog.toFixed(2), room: roomOf(cur()) };
  }

  window.__pq = { grow, links, linkTest, sweep, gapTest, escTest, realWalk, enter, place, diagnose, roomOf, cur, isMetro };
  return true;
};

// ───────────────────────── загрузка мира ─────────────────────────

async function boot(page, seed) {
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
  }, seed);
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
      await sleep(8000);
    }
  }
  await page.waitForFunction(() => window.__rf3d.props.ready, null, { timeout: 90000 });
  await sleep(1500);
  // отрисовка дешевле (мы почти не смотрим): мельче холст
  await page.evaluate(() => window.__rf3d.scene.getEngine().setHardwareScalingLevel(4));
  await page.evaluate(LIB);
}

const fmtBlock = (dg) => {
  if (!dg) return '—';
  const h = dg.probe ?? dg.colHit ?? dg.left?.hit ?? dg.right?.hit;
  if (!h) return 'ничего (пробный сдвиг свободен)';
  if (h.propId) return `предмет ${h.propId} (${h.ownerRoom})`;
  if (h.solid) return `${h.solid.kind} куска ${h.ownerRoom}${h.solid.room && h.solid.room !== h.ownerRoom ? ' (объём ' + h.solid.room + ')' : ''}`;
  return `${h.kind ?? '?'} ${h.name}${h.ownerRoom ? ' (' + h.ownerRoom + ')' : ''}`;
};

/**
 * Принятые находки (не ошибка, но в отчёте): обломки сгоревшего эскалатора (p_metro_esc_wreck, сгоревший зал) непроходимы
 * всем планом 6.0 × 3.6 — коллайдер 0.8; перед низом балюстрад модели — полоса сажи на полу до ~0.45 м (не проход: проёмы
 * зала — на юге, западе и востоке).
 */
const accepted = (f) => {
  const d = f.diag;
  if (!d) return null;
  const h = d.probe ?? d.colHit;
  if (h?.propId === 'p_metro_esc_wreck' && (d.colAhead ?? 0) <= 0.4) return 'обломки сгоревшего эскалатора: полоса сажи перед моделью (≤ 0.45 м), проход не нужен';
  return null;
};

// ───────────────────────── прогон ─────────────────────────

const all = { links: [], rooms: [], gaps: [], esc: [] };
let bad = 0;
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/pointer ?lock|AudioContext|autoplay/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
  for (const seed of SEEDS) {
    const t0 = Date.now();
    await boot(page, seed);
    const n = await page.evaluate((n) => window.__pq.grow(n), N);
    console.log(`\n═══ сид ${seed}: ${n} комнат (${((Date.now() - t0) / 1000).toFixed(0)} с)`);
    // отладка: QA_EVAL=<файл> — тело async-функции, выполняется в странице после роста мира; результат — в лог
    if (process.env.QA_EVAL) {
      const body = (await import('node:fs')).readFileSync(process.env.QA_EVAL, 'utf8');
      const r = await page.evaluate((body) => new Function('return (async () => {' + body + '\n})()')(), body);
      writeFileSync(`${OUT}passages-eval.json`, JSON.stringify(r, null, 1));
      console.log(`  результат — tmp/metro-wip/passages-eval.json`);
      continue;
    }
    const res = { seed, links: [], rooms: [], gaps: [], esc: [] };

    if (want('links')) {
      const L = await page.evaluate(() => window.__pq.links());
      // по комнате a подряд — меньше смен текущей
      L.sort((p, q) => (p.a < q.a ? -1 : p.a > q.a ? 1 : 0));
      const t1 = Date.now();
      for (let k = 0; k < L.length; k += 12) {
        const part = await page.evaluate(async (ls) => {
          const out = [];
          for (const l of ls) {
            out.push(...window.__pq.linkTest(l));
            await new Promise((r) => setTimeout(r, 0));
          }
          return out;
        }, L.slice(k, k + 12));
        res.links.push(...part);
      }
      const fail = res.links.filter((r) => !r.ok);
      console.log(`  links: ${L.length} сторон проёмов, ${res.links.length} проходов, не прошёл ${fail.length} (${((Date.now() - t1) / 1000).toFixed(0)} с)`);
      for (const f of fail.slice(0, 60)) {
        console.log(`   FAIL ${f.ra} → ${f.rb} [${f.tag}${f.wrap ? ', шов' : ''}] t=${f.t} прошёл ${f.prog}/${f.need} в ${f.end}: ${f.err ?? fmtBlock(f.diag)}${f.diag ? ` (видно впереди ${f.diag.visAhead} м, коллайдер ${f.diag.colAhead} м)` : ''}`);
      }
    }

    if (want('rooms')) {
      // по экземпляру каждого вида комнат метро (с соседями в мире)
      const ids = await page.evaluate(() => {
        const S = window.__rfWalk, seen = new Map();
        for (const i of S.rx.instances) if (window.__pq.isMetro(i) && !seen.has(i.roomId) && !(i.roomTags ?? []).includes('эскалатор')) seen.set(i.roomId, i.id);
        return [...seen.values()];
      });
      const t1 = Date.now();
      for (const id of ids) {
        const r = await page.evaluate(async (id) => {
          const r = window.__pq.sweep(id);
          await new Promise((res) => setTimeout(res, 0));
          return r;
        }, id);
        res.rooms.push(r);
        const gp = await page.evaluate((id) => window.__pq.gapTest(id), id);
        res.gaps.push(...gp);
        const gb = gp.filter((g) => !g.ok);
        console.log(`  room ${r.roomId}: линий ${r.lines}, остановок ${r.stops}, находок ${r.found?.length ?? r.err}; в просветах (пилоны, предметы) ${gp.length - gb.length}/${gp.length}`);
        for (const g of gb.slice(0, 6)) console.log(`     ПРОСВЕТ ${g.between ?? "пилоны"} ${g.gap} у ${g.at} ${g.dir}: прошёл ${g.prog}/${g.need} — ${fmtBlock(g.diag)} (видно ${g.diag?.visAhead} м, коллайдер ${g.diag?.colAhead} м)`);
        for (const f of (r.found ?? []).slice(0, 8)) {
          console.log(`     ${f.fell ? 'ПРОВАЛ' : 'НЕВИДИМОЕ'} ${f.axis}=${f.c} ${f.dir > 0 ? '+' : '-'} у ${f.at}: ${f.fell ? '' : fmtBlock(f.diag)} (видно ${f.diag?.visAhead} м, коллайдер ${f.diag?.colAhead} м)`);
        }
      }
      console.log(`  rooms: ${ids.length} видов (${((Date.now() - t1) / 1000).toFixed(0)} с)`);
    }

    if (want('esc')) {
      const ids = await page.evaluate(() => window.__rfWalk.rx.instances.filter((i) => (i.roomTags ?? []).includes('эскалатор')).slice(0, 4).map((i) => i.id));
      for (const id of ids) {
        const r = await page.evaluate((id) => window.__pq.escTest(id), id);
        res.esc.push(...r);
        for (const e of r) console.log(`  esc ${e.roomId} дорожка ${e.lane} ${e.dir}: ${e.ok ? 'OK' : 'FAIL'} прошёл ${e.prog} (марш ${e.len}), ноги ${e.feet} ${e.ok ? '' : fmtBlock(e.diag)}`);
      }
    }

    // подтверждение находок настоящими кадрами (первые по одной на вид) и снимки
    const fails = res.links.filter((r) => !r.ok && r.diag);
    const kinds = new Map();
    for (const f of fails) {
      const key = `${f.ra}→${f.rb}|${f.tag}|${fmtBlock(f.diag)}`;
      if (!kinds.has(key)) kinds.set(key, f);
    }
    for (const [key, f] of [...kinds].slice(0, 12)) {
      const real = await page.evaluate(async (f) => {
        const pq = window.__pq;
        const pa = pq.enter(f.a);
        const q = pa.portals.find((q) => q.to === f.b && ((q.a.inst === f.a && q.a.connector === f.ac) || (q.b.inst === f.a && q.b.connector === f.ac)));
        const dx = q.axis === 'x' ? q.dir : 0, dy = q.axis === 'y' ? q.dir : 0;
        const [x, y] = q.axis === 'x' ? [q.at - q.dir * f.s0, f.t] : [f.t, q.at - q.dir * f.s0];
        return pq.realWalk(x, y, q.z, dx, dy, f.need + 0.05, 5000);
      }, f);
      f.real = real;
      console.log(`   кадрами: ${key} → прошёл ${real.prog}/${f.need}, в ${real.room}`);
      if (SHOTS) {
        await page.evaluate(() => window.__rf3d.scene.getEngine().setHardwareScalingLevel(1));
        await sleep(400);
        const name = `pass-${seed}-${f.ra}-${f.rb}`.replace(/[^\w.-]+/g, '_');
        await page.screenshot({ path: `${OUT}shots/${name}.png` });
        await page.evaluate(() => window.__rf3d.scene.getEngine().setHardwareScalingLevel(4));
      }
    }
    writeFileSync(`${OUT}passages-${seed}.json`, JSON.stringify(res, null, 1));
    all.links.push(...res.links.map((r) => ({ seed, ...r })));
    all.rooms.push(...res.rooms.map((r) => ({ seed, ...r })));
    all.esc.push(...res.esc.map((r) => ({ seed, ...r })));
    all.gaps.push(...res.gaps.map((r) => ({ seed, ...r })));
  }
} catch (e) {
  console.error(e);
  bad++;
} finally {
  await browser.close();
  await server.close();
}

// ───────────────────────── сводка ─────────────────────────

const rows = new Map();
const add = (place, room, what, n = 1) => {
  const k = `${place}|${room}|${what}`;
  rows.set(k, (rows.get(k) ?? 0) + n);
};
for (const f of all.links.filter((r) => !r.ok)) add(`проём ${f.ra} → ${f.rb} [${f.tag}${f.wrap ? ', шов' : ''}]`, f.ra, f.err ?? fmtBlock(f.diag));
for (const r of all.rooms) for (const f of (r.found ?? []).filter((f) => !accepted(f))) add(`внутри: ${f.axis === 'y' ? 'вдоль y' : 'вдоль x'}`, r.roomId, f.fell ? 'провал' : fmtBlock(f.diag));
for (const g of all.gaps.filter((g) => !g.ok)) add(`просвет ${g.between ?? "пилоны"} ${g.gap} м`, g.roomId, fmtBlock(g.diag));
for (const e of all.esc.filter((e) => !e.ok)) add(`эскалатор, дорожка ${e.lane} ${e.dir}`, e.roomId, fmtBlock(e.diag));
const linkN = all.links.filter((r) => !r.skip).length, linkBad = all.links.filter((r) => !r.ok).length;
const roomFound = all.rooms.reduce((n, r) => n + (r.found ?? []).filter((f) => !accepted(f)).length, 0);
const acc = all.rooms.flatMap((r) => (r.found ?? []).filter((f) => accepted(f)).map((f) => ({ room: r.roomId, why: accepted(f) })));
const escBad = all.esc.filter((e) => !e.ok).length;
const gapBad = all.gaps.filter((g) => !g.ok).length;
const md = [
  `# Проходы метро — последний прогон tools/qa-metro-passages.mjs`,
  ``,
  `Сиды: ${SEEDS.join(', ')}; комнат на сид: ~${N}. Проходов через проёмы: ${linkN}, не прошёл: ${linkBad}. Комнат насквозь: ` +
    `${all.rooms.length} (линий ${all.rooms.reduce((n, r) => n + (r.lines ?? 0), 0)}), невидимых препятствий: ${roomFound}. ` +
    `В просветах (пилоны, предметы): ${all.gaps.length} проходов, не прошёл: ${gapBad}. Эскалатор: ${all.esc.length} проходов, не прошёл: ${escBad}.`,
  ``,
  `| место | комната | что держит | раз |`,
  `|---|---|---|---|`,
  ...[...rows].sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k.split('|').join(' | ')} | ${n} |`),
  ``,
  ...(acc.length ? [`Принято (не ошибка): ${[...new Set(acc.map((a) => `${a.room} — ${a.why}`))].join('; ')} — ${acc.length} раз.`, ``] : []),
];
writeFileSync(`${OUT}passages-last.md`, md.join('\n'));
console.log('\n' + md.join('\n'));
if (errors.length) console.log('ошибки страницы:', errors.slice(0, 5).join(' | '));
process.exit(bad || linkBad || roomFound || escBad || gapBad ? 1 : 0);
