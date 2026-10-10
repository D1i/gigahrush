// «Улыбка» в «Прогулке» — моб биома «Общага» (tmp/smile-wip/CONTRACT.md §9.2). Механика — src/locations/smile.ts
// (createSmile → stepSmile → события, smileView, smileLocked), модель — ./smileModel.ts (SmileModel, RedEyes,
// BloodSpurt), звук — ./smileAudio.ts, общага — ./obshagaWalk.ts (фасад: hooks, seen, kill, hold, closeDoor, lightLevel).
//
//  • Ведёт механику хост коопа или одиночная игра (obsh.isAuthority()): stepSmile каждый кадр, пока в общаге хоть кто-то.
//    Входы: игроки (свой — камера, напарники — PlayerState), скорость — по смещениям за окно VEL_WIN_S, фонарь в руке
//    (свой — хотбар: it_flashlight / «Жучок» в активной ячейке; напарники — 'smileMe'), видит ли её избранный и держит ли в
//    круге прицела (считает сам избранный по голове модели: obsh.seen — кадр и цепочка проёмов; прицел — угол от оси
//    камеры), в какой жилой комнате стоит (≥ insideM за проёмом двери), темно ли (свет режиссёра < darkLevel).
//  • Места выглядывания (spots, только для избранного): двери жилых комнат (модель в проёме у ближнего к нему косяка,
//    голова — в коридор; закрытую дверь хост тихо приоткрывает), углы коридора (поворот: стоит за ребром стены в соседнем
//    куске, голова — в кусок поворота), окна (лицо и ладони прижаты к раме, поверх — полупрозрачное «стекло»; тело — в
//    стене). Фильтр — прямая видимость на плане (losPlan: отрезок проходит цепочкой проёмов) и путь по графу (reachFrom).
//    ahead() — по коридору в сторону скорости (середина прохода, не ближе 3 м), far() — комната ≥ 15 м по графу.
//  • Кооп: свой канал fx — 'smile' (хост → все, 10 Гц: состояние механики целиком + события с прошлого среза; новый хост
//    подхватывает последний свежий срез), 'smileMe' (клиент → хост, 10 Гц: f — фонарь в руке, s — видит её, a — в прицеле).
//    Клиенты двигают часы фазы сами между срезами (плавное выглядывание).
//  • Видит её только избранный (модель — в portal.extraProviders комнат, где стоит, только у него); жертва броска — её
//    лицо в упор, потом её над собой с пола; остальные (и избранный) — струю крови из шеи аватара жертвы. Сердце и писк —
//    у избранного; хруст — у всех в общаге; бросок, еда, скрип двери-ловушки — у жертвы, у остальных — в мире.
//  • Ловушка: хост закрывает дверь (obsh.closeDoor) и запирает (hooks.locked по smileLocked); у жертвы — скрип, лампочки
//    бьются (hooks.light → 0), красные зрачки кружат и смех, сердце и удушье, затемнение — смерть с объяснением правила.
//  • Свой DOM-оверлей (красная пульсация в такт сердцу, пелена жертвы, затемнение) — дочерний элемент родителя канваса.
import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import {
  createSmile, forceSmile, smileLocked, smileView, stepSmile, SMILE,
  type SmileCandidate, type SmileEvent, type SmilePlayer, type SmileSpot, type SmileState, type SmileView,
} from '../locations/smile';
import type { Pt } from '../locations/obshaga';
import { isDormInstance } from '../locations/obshagaRooms';
import type { RunExport } from '../blockout/types';
import { roomAt, sideNormal, type ObshNav } from './obshagaNav';
import { PLAYER_SPEED, type ObshagaWalk } from './obshagaWalk';
import { BloodSpurt, RedEyes, SmileModel, SMILE_MODEL } from './smileModel';
import { heartBpm, SmileAudio } from './smileAudio';
import { PORTAL_LAYER } from './portal';
import type { CoopSession } from '../coop/session';
import type { CoopPresence } from '../coop/presence';

/** Ручки интеграции (не механики): обычный изменяемый объект. */
export const SMILE_WALK = {
  /** кооп: срез хоста и отчёт клиента — раз в столько мс; отчёт старше reportTtl — не в счёт */
  sendMs: 100,
  reportTtl: 1200,
  /** новый хост подхватывает срез не старше, мс */
  adoptMs: 5000,
  /** темно (новые выглядывания не начинаются): свет режиссёра ниже */
  darkLevel: 0.35,
  /** «внутри жилой комнаты»: за проёмом её двери не меньше, м */
  insideM: 0.6,
  /** предметы-«фонарь» (держащий — избранный) */
  flashItems: ['it_flashlight', 'it_bug_flash'] as string[],
  /** места выглядывания: путь от избранного не дальше, м */
  spotMaxM: 22,
  /** «в кадре» у избранного (для механики: выбирать охотнее) — полуугол конуса взгляда на плане, рад */
  viewHalf: 0.75,
  /** полутолщина стены у двери: от середины проёма до коридорной грани, м */
  wallHalf: 0.06,
  /** дверь годится для выглядывания: зритель дальше doorFarM или вдоль стены в doorSlant раз дальше, чем от неё */
  doorFarM: 5.5,
  doorSlant: 2.2,
  /** провокация: не ближе к игроку, м */
  aheadMinM: 3,
  /** хруст: далёкая комната — путь не меньше, м */
  farM: 15,
  /** скорость игрока — по смещению за окно, с; быстрее maxV — телепорт (0) */
  velWinS: 0.25,
  maxV: 8,
  /** звуки броска / еды / двери-ловушки у остальных — ближе, м */
  hearM: 20,
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const smooth = (k: number) => {
  const t = clamp01(k);
  return t * t * (3 - 2 * t);
};
const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

// ───────────────────────── карта (чистая, тесты) ─────────────────────────

/** Проём между комнатами на плане: отрезок a—b (м), середина c, единичное направление прохода d (из этой комнаты в to). */
export interface SmOpening {
  to: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  cx: number;
  cy: number;
  dx: number;
  dy: number;
}

/** Окно комнаты: середина рамы на плане (плоскость рамы), единичная нормаль в комнату, ширина, м. */
export interface SmWindow {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

export interface SmRoom {
  id: string;
  z: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  obsh: boolean;
  /** жилая комната («её» комната — ловушка) */
  dorm: boolean;
  stair: boolean;
  open: SmOpening[];
  windows: SmWindow[];
}

/** Дверь жилой комнаты (ObshDoor с room — жилой): середина проёма, нормаль в коридор, пол коридора, ширина. */
export interface SmDoor {
  id: string;
  room: string;
  cor: string;
  x: number;
  y: number;
  nx: number;
  ny: number;
  z: number;
  w: number;
}

export interface SmileMap {
  rooms: Map<string, SmRoom>;
  doors: SmDoor[];
  doorsByRoom: Map<string, SmDoor[]>;
}

const mapCache = new WeakMap<RunExport, { nav: ObshNav; map: SmileMap }>();

/** Карта «Улыбки» по прогону и навигации общаги (кэш по объекту прогона). */
export function smileMapOf(rx: RunExport, nav: ObshNav): SmileMap {
  const hit = mapCache.get(rx);
  if (hit && hit.nav === nav) return hit.map;
  const c = rx.cellM > 0 ? rx.cellM : 0.1;
  const rooms = new Map<string, SmRoom>();
  for (const i of rx.instances) {
    const nr = nav.rooms.get(i.id);
    if (!nr) continue;
    const windows: SmWindow[] = [];
    for (const p of nr.props) {
      if (p.propId !== 'p_obsh_window') continue;
      const r = p.rect;
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
      let nx = 0, ny = 0;
      if (r.x1 - r.x0 >= r.y1 - r.y0) ny = cy - nr.y0 < nr.y1 - cy ? 1 : -1;
      else nx = cx - nr.x0 < nr.x1 - cx ? 1 : -1;
      windows.push({ x: cx, y: cy, nx, ny });
    }
    rooms.set(i.id, {
      id: i.id, z: nr.z, x0: nr.x0, y0: nr.y0, x1: nr.x1, y1: nr.y1,
      obsh: nr.obsh, dorm: isDormInstance(i), stair: nr.stair, open: [], windows,
    });
  }
  const conn = new Map<string, RunExport['instances'][number]['connectors'][number]>();
  for (const i of rx.instances) for (const k of i.connectors ?? []) conn.set(`${i.id}/${k.id}`, k);
  for (const l of rx.links ?? []) {
    if (l.wrap || l.sealed || (l.kind && l.kind !== 'door')) continue;
    const ka = conn.get(`${l.a.inst}/${l.a.connector}`), kb = conn.get(`${l.b.inst}/${l.b.connector}`);
    const ra = rooms.get(l.a.inst), rb = rooms.get(l.b.inst);
    if (!ka || !kb || !ra || !rb) continue;
    const [ax, ay, bx, by] = ka.line.map((v) => v * c);
    const [nx, ny] = sideNormal(ka.side);
    const o = { ax, ay, bx, by, cx: (ax + bx) / 2, cy: (ay + by) / 2 };
    ra.open.push({ to: rb.id, ...o, dx: -nx, dy: -ny });
    rb.open.push({ to: ra.id, ...o, dx: nx, dy: ny });
  }
  const doors: SmDoor[] = [];
  const doorsByRoom = new Map<string, SmDoor[]>();
  for (const d of nav.doors) {
    if (!d.room || !rooms.get(d.room)?.dorm) continue;
    const sd: SmDoor = { id: d.id, room: d.room, cor: d.cor, x: d.x, y: d.y, nx: d.nx, ny: d.ny, z: d.z, w: d.widthM };
    doors.push(sd);
    for (const r of [d.room, d.cor]) {
      const l = doorsByRoom.get(r);
      if (l) l.push(sd);
      else doorsByRoom.set(r, [sd]);
    }
  }
  const map = { rooms, doors, doorsByRoom };
  mapCache.set(rx, { nav, map });
  return map;
}

/** Параметр t ∈ [t0, 1], где отрезок a→b выходит из рамки комнаты (с запасом pad); не входит — t0. */
function exitT(r: SmRoom, a: { x: number; y: number }, b: { x: number; y: number }, t0: number, pad = 0.05): number {
  let lo = -Infinity, hi = Infinity;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, d, mn, mx] of [[a.x, dx, r.x0 - pad, r.x1 + pad], [a.y, dy, r.y0 - pad, r.y1 + pad]] as const) {
    if (Math.abs(d) < 1e-12) {
      if (p < mn || p > mx) return t0;
      continue;
    }
    let t1 = (mn - p) / d, t2 = (mx - p) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    lo = Math.max(lo, t1);
    hi = Math.min(hi, t2);
  }
  return hi >= lo ? Math.max(t0, Math.min(1, hi)) : t0;
}

/** Пересечение отрезка a→b с проёмом o (суженным на jamb с концов): параметр t на a→b или null. */
function crossT(a: { x: number; y: number }, b: { x: number; y: number }, o: SmOpening, jamb: number): number | null {
  let ox = o.bx - o.ax, oy = o.by - o.ay;
  const L = Math.hypot(ox, oy);
  if (L < 2 * jamb + 0.05) return null;
  ox /= L;
  oy /= L;
  const px = o.ax + ox * jamb, py = o.ay + oy * jamb, qx = o.bx - ox * jamb, qy = o.by - oy * jamb;
  const rx = b.x - a.x, ry = b.y - a.y, sx = qx - px, sy = qy - py;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((px - a.x) * sy - (py - a.y) * sx) / den;
  const u = ((px - a.x) * ry - (py - a.y) * rx) / den;
  return t >= -1e-6 && t <= 1 + 1e-6 && u >= 0 && u <= 1 ? t : null;
}

/**
 * Прямая видимость на плане: из a (a.room) видно b (b.room), если отрезок проходит цепочкой проёмов — из каждой комнаты
 * выходит сквозь проём (косяки по 8 см), не сквозь стену её рамки. Комнаты на разной высоте (> 1 м) — не видно.
 */
export function losPlan(map: SmileMap, a: Pt, b: Pt, maxHops = 10): boolean {
  if (!a.room || !b.room) return false;
  const ra = map.rooms.get(a.room), rb = map.rooms.get(b.room);
  if (!ra || !rb || Math.abs(ra.z - rb.z) > 1) return false;
  let room = a.room;
  let t = 0;
  const seen = new Set([room]);
  for (let hop = 0; hop <= maxHops; hop++) {
    if (room === b.room) return true;
    const R = map.rooms.get(room);
    if (!R) return false;
    const tx = exitT(R, a, b, t);
    let best: { to: string; t: number } | null = null;
    for (const o of R.open) {
      if (seen.has(o.to)) continue;
      const k = crossT(a, b, o, 0.08);
      if (k === null || k < t - 1e-6 || k > tx + 0.02) continue;
      if (!best || k < best.t) best = { to: o.to, t: k };
    }
    if (!best) return false;
    room = best.to;
    t = best.t;
    seen.add(room);
  }
  return false;
}

/** Дейкстра по комнатам от точки from: путь до каждой комнаты (вход — середина проёма), не дальше maxM. */
export function reachFrom(map: SmileMap, from: Pt, maxM: number): Map<string, { d: number; e: Pt }> {
  const out = new Map<string, { d: number; e: Pt }>();
  if (!from.room || !map.rooms.has(from.room)) return out;
  const q: { room: string; d: number; e: Pt }[] = [{ room: from.room, d: 0, e: { x: from.x, y: from.y } }];
  while (q.length) {
    let k = 0;
    for (let i = 1; i < q.length; i++) if (q[i].d < q[k].d) k = i;
    const cur = q.splice(k, 1)[0];
    if (out.has(cur.room)) continue;
    out.set(cur.room, { d: cur.d, e: cur.e });
    for (const o of map.rooms.get(cur.room)?.open ?? []) {
      const to = map.rooms.get(o.to);
      if (!to || !to.obsh || out.has(o.to)) continue;
      const nd = cur.d + Math.hypot(o.cx - cur.e.x, o.cy - cur.e.y);
      if (nd <= maxM) q.push({ room: o.to, d: nd, e: { x: o.cx, y: o.cy } });
    }
  }
  return out;
}

/** Путь до точки p (p.room) по результату reachFrom, м; нет — null. */
export function pathTo(reach: Map<string, { d: number; e: Pt }>, p: Pt): number | null {
  const r = p.room ? reach.get(p.room) : undefined;
  return r ? r.d + Math.hypot(p.x - r.e.x, p.y - r.e.y) : null;
}

/**
 * Расстановка выглядывания на плане (как SmileModel.placePeek, оси Babylon: X = x, Z = −y): edge — ребро косяка/угла,
 * into — единичная горизонталь из стены туда, куда она высовывается, viewer — зритель. root — между ступнями, head —
 * центр головы при lean 1, yaw — куда она обращена (план), side — сторона наклона.
 */
export function peekPlace(edge: { x: number; y: number }, into: { x: number; y: number }, viewer: { x: number; y: number }) {
  const P = SMILE_MODEL.peek;
  const Ex = edge.x, Ez = -edge.y, Ix = into.x, Iz = -into.y, Vx = viewer.x, Vz = -viewer.y;
  let ax = Iz, az = -Ix;
  if ((Vx - Ex) * ax + (Vz - Ez) * az < 0) (ax = -ax), (az = -az);
  const rx = az, rz = -ax;
  const side: -1 | 1 = rx * Ix + rz * Iz >= 0 ? 1 : -1;
  const ox = Ex - rx * side * P.jambX - ax * P.jambZ, oz = Ez - rz * side * P.jambX - az * P.jambZ;
  const hx = ox + rx * side * P.head.x + ax * P.head.z, hz = oz + rz * side * P.head.x + az * P.head.z;
  return { root: { x: ox, y: -oz }, head: { x: hx, y: -hz }, yaw: Math.atan2(-az, ax), side };
}

/** Поворот модели (rotation.y Babylon) по углу плана yaw (куда обращена). */
export const yawB = (yaw: number): number => Math.atan2(Math.cos(yaw), -Math.sin(yaw));

/** Обратная к peekPlace: где стоит модель (план) по месту выглядывания (голова, yaw, side). */
export function spotRoot(sp: Pick<SmileSpot, 'p' | 'yaw' | 'side' | 'kind'>): { x: number; y: number } {
  const ax = Math.cos(sp.yaw), az = -Math.sin(sp.yaw);
  if (sp.kind === 'window') {
    const g = SMILE_MODEL.window.glassZ;
    return { x: sp.p.x - ax * g, y: sp.p.y + az * g };
  }
  const P = SMILE_MODEL.peek;
  const rx = az, rz = -ax, s = sp.side;
  const ox = sp.p.x - rx * s * P.head.x - ax * P.head.z;
  const oz = -sp.p.y - rz * s * P.head.x - az * P.head.z;
  return { x: ox, y: -oz };
}

/**
 * Годится ли дверь для выглядывания на зрителя: спрятанное за косяком тело видно сквозь проём тому, кто стоит напротив
 * близко, — нужен зритель дальше doorFarM или под острым углом к стене (вдоль неё в doorSlant раз дальше, чем от неё).
 */
export function doorAngleOk(d: Pick<SmDoor, 'x' | 'y' | 'nx' | 'ny'>, viewer: { x: number; y: number }): boolean {
  const dx = viewer.x - d.x, dy = viewer.y - d.y;
  const across = dx * d.nx + dy * d.ny;
  if (across < 0.3) return false;
  const along = Math.abs(dx * -d.ny + dy * d.nx);
  return Math.hypot(dx, dy) >= SMILE_WALK.doorFarM || along >= SMILE_WALK.doorSlant * across;
}

/** Выглядывание из двери жилой комнаты: у ближнего к зрителю косяка, голова — в коридор. */
export function doorSpot(d: SmDoor, viewer: { x: number; y: number }): SmileSpot {
  const t = SMILE_WALK.wallHalf;
  const cx = d.x + d.nx * t, cy = d.y + d.ny * t;
  // вдоль стены — к зрителю
  let ax = -d.ny, ay = d.nx;
  if ((viewer.x - cx) * ax + (viewer.y - cy) * ay < 0) (ax = -ax), (ay = -ay);
  const pl = peekPlace({ x: cx + ax * d.w * 0.5, y: cy + ay * d.w * 0.5 }, { x: d.nx, y: d.ny }, viewer);
  return { id: `door:${d.id}`, kind: 'door', p: { x: pl.head.x, y: pl.head.y, room: d.cor }, z: d.z, yaw: pl.yaw, side: pl.side, hideRoom: d.room, door: d.id };
}

/**
 * Углы коридорного куска R (не жилого, не лестницы): пары проёмов под прямым углом с общим концом P (внутренний угол
 * поворота). Зритель за проёмом A — она стоит за ребром P в куске за проёмом B и высовывается в R (into = −dB).
 */
export function cornerSpots(map: SmileMap, R: SmRoom, viewer: { x: number; y: number }): SmileSpot[] {
  const out: SmileSpot[] = [];
  if (!R.obsh || R.dorm || R.stair) return out;
  const cor = (id: string) => {
    const r = map.rooms.get(id);
    return !!r && r.obsh && !r.dorm && !r.stair;
  };
  const opens = R.open.filter((o) => cor(o.to));
  for (const A of opens) {
    for (const B of opens) {
      if (A === B || Math.abs(A.dx * B.dx + A.dy * B.dy) > 0.2) continue;
      // общий конец
      let P: { x: number; y: number } | null = null;
      for (const p of [{ x: A.ax, y: A.ay }, { x: A.bx, y: A.by }]) {
        for (const q of [{ x: B.ax, y: B.ay }, { x: B.bx, y: B.by }]) if (d2(p, q) < 0.35) P = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      }
      if (!P) continue;
      if ((viewer.x - P.x) * A.dx + (viewer.y - P.y) * A.dy < 0.3) continue;
      const pl = peekPlace(P, { x: -B.dx, y: -B.dy }, viewer);
      out.push({ id: `corner:${R.id}:${B.to}`, kind: 'corner', p: { x: pl.head.x, y: pl.head.y, room: R.id }, z: R.z, yaw: pl.yaw, side: pl.side, hideRoom: null });
    }
  }
  return out;
}

/** Окно комнаты: лицо — в середине ближней к зрителю створки, у самой рамы; обращена в комнату. */
export function windowSpot(R: SmRoom, w: SmWindow, k: number, viewer: { x: number; y: number }): SmileSpot {
  const tx = -w.ny, ty = w.nx;
  const s = (viewer.x - w.x) * tx + (viewer.y - w.y) * ty >= 0 ? 1 : -1;
  const x = w.x + tx * s * 0.295 + w.nx * 0.005, y = w.y + ty * s * 0.295 + w.ny * 0.005;
  return { id: `window:${R.id}:${k}`, kind: 'window', p: { x, y, room: R.id }, z: R.z, yaw: Math.atan2(w.ny, w.nx), side: 1, hideRoom: null };
}

/** Корридор ли (не жилая, не лестница, общага). */
const isCor = (r: SmRoom | undefined): r is SmRoom => !!r && r.obsh && !r.dorm && !r.stair;

/** Насколько можно пройти из p по dir внутри рамки R (с отступом m), м. */
function rayIn(R: SmRoom, p: { x: number; y: number }, dir: { x: number; y: number }, m: number): number {
  let t = Infinity;
  if (dir.x > 1e-6) t = Math.min(t, (R.x1 - m - p.x) / dir.x);
  if (dir.x < -1e-6) t = Math.min(t, (R.x0 + m - p.x) / dir.x);
  if (dir.y > 1e-6) t = Math.min(t, (R.y1 - m - p.y) / dir.y);
  if (dir.y < -1e-6) t = Math.min(t, (R.y0 + m - p.y) / dir.y);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/**
 * Точка провокации: по коридору в сторону скорости игрока (стоит — куда смотрит) на distM пути, посреди прохода
 * (поперёк длинного куска — на его оси), лицом к игроку. Из жилой комнаты — сначала в коридор. Ближе aheadMinM — null.
 */
export function aheadPoint(map: SmileMap, pl: Pick<SmilePlayer, 'p' | 'vx' | 'vy' | 'fx' | 'fy'>, distM: number): { p: Pt; z: number; yaw: number } | null {
  const sp = Math.hypot(pl.vx, pl.vy);
  let dir = sp > 0.4 ? { x: pl.vx / sp, y: pl.vy / sp } : { x: pl.fx, y: pl.fy };
  const dl = Math.hypot(dir.x, dir.y);
  if (dl < 1e-6) return null;
  dir = { x: dir.x / dl, y: dir.y / dl };
  let room = pl.p.room;
  let pos = { x: pl.p.x, y: pl.p.y };
  let left = Math.max(0, distM);
  let prev: string | null = null;
  const finish = (R: SmRoom, q: { x: number; y: number }) => {
    const w = R.x1 - R.x0, h = R.y1 - R.y0;
    let x = q.x, y = q.y;
    if (w >= h * 1.4) y = (R.y0 + R.y1) / 2;
    else if (h >= w * 1.4) x = (R.x0 + R.x1) / 2;
    const m = Math.min(0.5, w / 2 - 0.05, h / 2 - 0.05);
    x = clamp(x, R.x0 + m, R.x1 - m);
    y = clamp(y, R.y0 + m, R.y1 - m);
    if (Math.hypot(x - pl.p.x, y - pl.p.y) < SMILE_WALK.aheadMinM) return null;
    return { p: { x, y, room: R.id }, z: R.z, yaw: Math.atan2(pl.p.y - y, pl.p.x - x) };
  };
  for (let hop = 0; hop < 12 && room; hop++) {
    const R = map.rooms.get(room);
    if (!R) return null;
    let best: SmOpening | null = null;
    let bs = -Infinity;
    for (const o of R.open) {
      if (o.to === prev || !isCor(map.rooms.get(o.to))) continue;
      const ex = o.cx - pos.x, ey = o.cy - pos.y, L = Math.hypot(ex, ey);
      const toward = L > 0.05 ? (ex * dir.x + ey * dir.y) / L : 1;
      // выход за спиной — не вперёд (тупик впереди — некуда)
      if (toward < -0.2 && isCor(R)) continue;
      const s = toward + 0.5 * (o.dx * dir.x + o.dy * dir.y);
      if (s > bs) (bs = s), (best = o);
    }
    if (isCor(R)) {
      // впереди по ходу выхода нет: хватит места до стены — там; нет — поворот к лучшему выходу (вышел из комнаты
      // поперёк коридора — дальше вдоль него)
      const along = rayIn(R, pos, dir, 0.5);
      if (!best || (bs < 0.3 && along >= left)) return finish(R, { x: pos.x + dir.x * Math.min(left, along), y: pos.y + dir.y * Math.min(left, along) });
      const L = Math.hypot(best.cx - pos.x, best.cy - pos.y);
      if (L >= left) return finish(R, { x: pos.x + ((best.cx - pos.x) / Math.max(L, 1e-6)) * left, y: pos.y + ((best.cy - pos.y) / Math.max(L, 1e-6)) * left });
      left -= L;
    } else {
      if (!best) return null;
      left -= Math.hypot(best.cx - pos.x, best.cy - pos.y);
    }
    pos = { x: best.cx, y: best.cy };
    dir = { x: best.dx, y: best.dy };
    prev = room;
    room = best.to;
  }
  return null;
}

/** Далёкая комната для хруста: путь не меньше minM (ближайшая из таких) — её середина; нет — null. */
export function farPoint(map: SmileMap, from: Pt, minM: number): Pt | null {
  const reach = reachFrom(map, from, minM + 40);
  let best: { id: string; d: number } | null = null;
  for (const [id, r] of reach) if (r.d >= minM && (!best || r.d < best.d || (r.d === best.d && id < best.id))) best = { id, d: r.d };
  if (!best) return null;
  const R = map.rooms.get(best.id)!;
  return { x: (R.x0 + R.x1) / 2, y: (R.y0 + R.y1) / 2, room: R.id };
}

/** Жилая комната, внутри которой стоит p (за проёмом каждой её двери ≥ insideM); иначе null. */
export function insideDorm(map: SmileMap, p: Pt): string | null {
  const R = p.room ? map.rooms.get(p.room) : undefined;
  if (!R || !R.dorm) return null;
  for (const d of map.doorsByRoom.get(R.id) ?? []) {
    if (d.room !== R.id) continue;
    const depth = -((p.x - d.x) * d.nx + (p.y - d.y) * d.ny);
    if (depth < SMILE_WALK.insideM) return null;
  }
  return R.id;
}

/** Кандидаты выглядывания для зрителя ch (стадия — механике): двери жилых комнат, углы, окна; путь и видимость. */
export function smileSpots(map: SmileMap, ch: Pick<SmilePlayer, 'p' | 'fx' | 'fy'>, opts: { locked?: (doorId: string) => boolean } = {}): SmileCandidate[] {
  const out: SmileCandidate[] = [];
  const reach = reachFrom(map, ch.p, SMILE_WALK.spotMaxM + 6);
  const inView = (p: { x: number; y: number }) => {
    const dx = p.x - ch.p.x, dy = p.y - ch.p.y, L = Math.hypot(dx, dy);
    return L > 1e-6 && (dx * ch.fx + dy * ch.fy) / L >= Math.cos(SMILE_WALK.viewHalf);
  };
  const add = (spot: SmileSpot, look: Pt) => {
    const pathM = pathTo(reach, spot.p);
    if (pathM === null || pathM > SMILE_WALK.spotMaxM) return;
    if (!losPlan(map, ch.p, look)) return;
    out.push({ spot, pathM, inView: inView(spot.p) });
  };
  for (const d of map.doors) {
    if (!reach.has(d.cor) || opts.locked?.(d.id) || !doorAngleOk(d, ch.p)) continue;
    const sp = doorSpot(d, ch.p);
    add(sp, sp.p);
  }
  for (const id of reach.keys()) {
    const R = map.rooms.get(id)!;
    for (const sp of cornerSpots(map, R, ch.p)) add(sp, sp.p);
    R.windows.forEach((w, k) => {
      const sp = windowSpot(R, w, k, ch.p);
      // со стороны комнаты (не из-за стены) — видна точка чуть перед стеклом
      if ((ch.p.x - w.x) * w.nx + (ch.p.y - w.y) * w.ny < 0.5) return;
      add(sp, { x: sp.p.x + w.nx * 0.15, y: sp.p.y + w.ny * 0.15, room: R.id });
    });
  }
  return out;
}

// ───────────────────────── кооп ─────────────────────────

/** Срез хоста ('smile'). */
export interface SmileWire {
  q: number;
  s: SmileState;
  e: SmileEvent[];
}

function okState(s: unknown): s is SmileState {
  const o = s as SmileState | null;
  return !!o && typeof o === 'object' && typeof o.phase === 'string' && typeof o.stage === 'number' && typeof o.phaseT === 'number' && Array.isArray(o.rooms);
}

/** Клиент: часы фазы — вперёд на dt от среза (плавное выглядывание, бросок, разрыв); idle — без изменений. */
export function advanceState(s: SmileState, dt: number): SmileState {
  if (!(dt > 0) || s.phase === 'idle') return s;
  const phaseT = s.phaseDur > 0 ? Math.min(s.phaseDur, s.phaseT + dt) : s.phaseT + dt;
  const o: SmileState = { ...s, phaseT };
  if (s.phase === 'tear') o.torn = SMILE.tearS > 0 ? clamp01(phaseT / SMILE.tearS) : 1;
  if (s.eat && s.phase === 'eat') o.eat = { ...s.eat, t: phaseT };
  return o;
}

// ───────────────────────── интеграция ─────────────────────────

export interface SmileDeps {
  /** кооп: лобби (null — одиночная игра) */
  co: CoopSession | null;
  /** аватары напарников (шея жертвы — кровь) */
  presence(): CoopPresence | null;
  /** id предмета в активной ячейке хотбара (фонарь — избранный) */
  held(): string | null;
  /** сид мира */
  seed: string;
  /** прогон мира (проёмы, метки комнат) */
  rx(): RunExport | null;
  /** можно ли сейчас управлять (нет спец-сцены поверх, от первого лица) */
  live(): boolean;
}

/** Смерти: заголовок и подсказка (учат правилам). */
export const SMILE_DEATH = {
  eaten: { title: 'Она улыбнулась тебе', hint: 'Не подходи к ней ближе метра. Её видит только тот, у кого фонарь, — слушай его: где она стоит, туда не ходи.' },
  eatenChosen: {
    title: 'Она улыбнулась тебе',
    hint: 'Встала посреди прохода — ждёт, что подойдёшь. Не подходи ближе метра: смотри на неё и уходи другой дорогой, сама уйдёт. А лицо её не разглядывай — порвётся, и тогда беги.',
  },
  trap: {
    title: 'Дверь закрылась за тобой',
    hint: 'Не заходи в комнату, откуда она выглядывала: её видит только тот, у кого фонарь, — пусть скажет, куда нельзя. Пока дверь со скрипом закрывается — ещё можно выскочить.',
  },
};

const isFlash = (item: string | null | undefined) => !!item && SMILE_WALK.flashItems.includes(item);

/** Жертва: к концу броска её рот — столько перед глазами, м; лёжа — её голова (шея жертвы) столько впереди камеры, м;
 *  глаза лежащей жертвы над полом, м. */
const VICTIM_MOUTH_M = 0.65;
const VICTIM_NECK_M = 0.8;
const VICTIM_EYE = 0.3;

export class SmileWalk {
  /** механика (одиночная игра, хост) */
  private st: SmileState | null = null;
  /** срез хоста (клиент) */
  private remote: { s: SmileState; at: number; from: string; q: number } | null = null;
  private wireQ = 0;
  private wireEv: SmileEvent[] = [];
  private sentAt = 0;
  private reports = new Map<string, { at: number; f: boolean; s: boolean; a: boolean }>();
  private track = new Map<string, { x: number; y: number; t: number; vx: number; vy: number }>();
  private model: SmileModel | null = null;
  private eyes: RedEyes | null = null;
  private spurt: BloodSpurt | null = null;
  private glass: Mesh | null = null;
  private glassMat: StandardMaterial | null = null;
  readonly audio = new SmileAudio();
  /** меши по комнатам (portal.extraProviders) */
  private draw = new Map<string, Mesh[]>();
  private extrasOf: ReturnType<ObshagaWalk['portal']> = null;
  /** свой взгляд: видит её (избранный), в прицеле */
  private sees = false;
  private aim = false;
  private seenOnce = false;
  private on = false;
  private audible = true;
  private time = 0;
  private lastMap: SmileMap | null = null;
  private lastNav: ObshNav | null = null;
  /** двери, что она тихо приоткрыла (до, мс) */
  private quiet = new Map<string, number>();
  /** жертва — я: бросок к камере, потом еда (камера на полу) */
  private victim: { t: number; lost: number; from: Vector3 | null; chosen: boolean; dir: Vector3; floor: number; yaw0: number; eatT: number } | null = null;
  /** ловушка — я */
  private trapMe: { t: number } | null = null;
  private eyesPos = new Vector3();
  private shake = 0;
  private prevPhase = 'idle';
  private overlay: { root: HTMLDivElement; pulse: HTMLDivElement; veil: HTMLDivElement; black: HTMLDivElement } | null = null;
  private qaCalm = false;
  private obs: Observer<Scene> | null;
  private readonly hooks: { locked: (id: string) => string | null; light: () => number; silent: (id: string) => boolean };
  private onFxFn = (from: string, k: string, d: unknown) => this.fx(from, k, d);
  private onGesture = () => {
    if (this.on) this.audio.resume();
  };
  private extrasFn = (room: string): readonly Mesh[] | undefined => this.draw.get(room);

  constructor(
    private readonly scene: Scene,
    private readonly cam: UniversalCamera,
    private readonly obsh: ObshagaWalk,
    private readonly deps: SmileDeps,
  ) {
    this.hooks = {
      locked: (id) => {
        const s = this.cur();
        return s && smileLocked(s, id) ? 'Заперто. Не открывается' : null;
      },
      light: () => this.trapLight(),
      silent: (id) => (this.quiet.get(id) ?? 0) > performance.now(),
    };
    obsh.hooks.locked.push(this.hooks.locked);
    obsh.hooks.light.push(this.hooks.light);
    obsh.hooks.silent.push(this.hooks.silent);
    this.obs = scene.onBeforeRenderObservable.add(() => this.frame());
    deps.co?.onFx.add(this.onFxFn);
    window.addEventListener('keydown', this.onGesture);
    window.addEventListener('pointerdown', this.onGesture);
  }

  private get co(): CoopSession | null {
    return this.deps.co;
  }

  /** Состояние для картинки и замков: своё или срез хоста (с часами фазы вперёд). */
  private cur(): SmileState | null {
    if (this.st) return this.st;
    const r = this.remote;
    if (!r) return null;
    return advanceState(r.s, (performance.now() - r.at) / 1000);
  }

  // ───────────────────────── кадр ─────────────────────────

  private frame() {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60);
    this.time += dt;
    const rx = this.deps.rx();
    const nav = this.obsh.nav();
    if (!rx || !nav) return;
    const map = smileMapOf(rx, nav);
    this.lastMap = map;
    this.lastNav = nav;
    const on = this.obsh.inside();
    if (on !== this.on) {
      this.on = on;
      if (!on) this.leave();
    }
    // слышно: в общаге, звук общаги включён (кнопка HUD), жив
    const audible = on && this.obsh.audio.enabled && !this.obsh.dead;
    if (audible !== this.audible) {
      this.audible = audible;
      this.audio.fade(audible);
    }
    const portal = this.obsh.portal();
    if (portal !== this.extrasOf) {
      this.extrasOf?.extraProviders.delete(this.extrasFn);
      this.extrasOf = portal;
      portal?.extraProviders.add(this.extrasFn);
    }
    // ── механика: своя (хост, соло) или срез хоста
    if (this.obsh.isAuthority()) {
      if (!this.st) this.adopt();
      this.stepAuthority(dt, map, nav);
    } else if (this.st) {
      // стал клиентом (пришёл хост) — дальше по его срезам
      this.st = null;
    }
    const s = this.cur();
    const v = s ? smileView(s) : null;
    if (v && v.phase !== this.prevPhase) this.phaseFx(v);
    this.prevPhase = v?.phase ?? 'idle';
    // ── картинка, звук, свой взгляд
    this.render(dt, v, map, nav);
    this.observe(v, nav);
    this.coopSend();
  }

  /** Стал хостом (или соло): механика — с последнего свежего среза прежнего хоста, иначе новая. */
  private adopt() {
    const r = this.remote;
    if (r && performance.now() - r.at < SMILE_WALK.adoptMs) this.st = JSON.parse(JSON.stringify(advanceState(r.s, (performance.now() - r.at) / 1000)));
    else this.st = createSmile(`${this.deps.seed}/smile`);
    if (this.qaCalm && this.st!.stage === 0) this.st!.next = 1e9;
    this.remote = null;
  }

  private stepAuthority(dt: number, map: SmileMap, nav: ObshNav) {
    const st = this.st!;
    const players = this.players(map, nav);
    if (!players.some((p) => p.obsh && p.alive)) return;
    const ev = stepSmile(st, dt, {
      players,
      dark: this.obsh.lightLevel() < SMILE_WALK.darkLevel,
      walkSpeed: PLAYER_SPEED,
      spots: (_stage, ch) => smileSpots(map, ch, { locked: (id) => !!this.obsh.lockedMsg(id) && !smileLocked(st, id) }),
      ahead: (p, d) => aheadPoint(map, p, d),
      far: (ch) => farPoint(map, ch.p, SMILE_WALK.farM),
    });
    for (const e of ev) {
      this.hostEvent(e, map);
      this.event(e, map, nav);
      if (this.co) this.wireEv.push(e);
    }
    if (this.wireEv.length > 12) this.wireEv.splice(0, this.wireEv.length - 12);
  }

  /** Игроки для механики: свой (камера) и напарники (PlayerState + 'smileMe'). */
  private players(map: SmileMap, nav: ObshNav): SmilePlayer[] {
    const out: SmilePlayer[] = [];
    const now = performance.now();
    const me = this.obsh.me();
    const room = this.obsh.room();
    if (this.on && !this.obsh.dead && room && this.deps.live()) {
      const c = this.cam.position, yaw = this.cam.rotation.y;
      const p: Pt = { x: c.x, y: -c.z, room };
      const v = this.velOf(me, p, now);
      out.push({
        id: me, p, z: nav.rooms.get(room)?.z ?? 0, fx: Math.sin(yaw), fy: -Math.cos(yaw), vx: v.vx, vy: v.vy,
        flash: isFlash(this.deps.held()), sees: this.sees, aim: this.aim, room, inside: insideDorm(map, p), alive: true, obsh: true,
      });
    }
    for (const pl of this.co?.players.values() ?? []) {
      const s = pl.state;
      if (!s || s.loc || !s.room || !s.fps) continue;
      const rep = this.reports.get(pl.id);
      const fresh = !!rep && now - rep.at < SMILE_WALK.reportTtl;
      const p: Pt = { x: s.p[0], y: -s.p[2], room: s.room };
      const v = this.velOf(pl.id, p, now);
      out.push({
        id: pl.id, p, z: nav.rooms.get(s.room)?.z ?? 0, fx: Math.sin(s.yaw), fy: -Math.cos(s.yaw), vx: v.vx, vy: v.vy,
        flash: fresh && rep!.f, sees: fresh && rep!.s, aim: fresh && rep!.a, room: s.room, inside: insideDorm(map, p),
        alive: !s.dead, obsh: !!nav.rooms.get(s.room)?.obsh,
      });
    }
    for (const [id, t] of this.track) if (now - t.t > 5000) this.track.delete(id);
    return out;
  }

  /** Скорость на плане по смещениям за окно velWinS (телепорт — 0). */
  private velOf(id: string, p: Pt, now: number): { vx: number; vy: number } {
    const s = this.track.get(id);
    if (!s || now - s.t > 2000) {
      this.track.set(id, { x: p.x, y: p.y, t: now, vx: 0, vy: 0 });
      return { vx: 0, vy: 0 };
    }
    const dt = (now - s.t) / 1000;
    if (dt < SMILE_WALK.velWinS) return { vx: s.vx, vy: s.vy };
    let vx = (p.x - s.x) / dt, vy = (p.y - s.y) / dt;
    if (Math.hypot(vx, vy) > SMILE_WALK.maxV) vx = vy = 0;
    Object.assign(s, { x: p.x, y: p.y, t: now, vx, vy });
    return { vx, vy };
  }

  /** Только хост: двери (тихо приоткрыть, ловушка — закрыть, выскочил — отменить). */
  private hostEvent(e: SmileEvent, map: SmileMap) {
    if (e.type === 'peek' && e.spot.kind === 'door' && e.spot.door) {
      this.quiet.set(e.spot.door, performance.now() + 4000);
      this.obsh.openDoor(e.spot.door);
    } else if (e.type === 'trap' && e.door) {
      this.quiet.delete(e.door);
      this.obsh.closeDoor(e.door, SMILE.trapCloseS);
    } else if (e.type === 'trapEscape' && e.door) this.obsh.stopClose(e.door);
    else if (e.type === 'end' && this.qaCalm && this.st) this.st.next = 1e9;
    void map;
  }

  /** Мировая точка (Babylon) по точке плана: высота — пол её комнаты + h. */
  private world(p: Pt, h: number, nav: ObshNav | null = this.lastNav): Vector3 {
    const z = (p.room ? nav?.rooms.get(p.room)?.z : undefined) ?? this.cam.position.y - 1.6;
    return new Vector3(p.x, z + h, -p.y);
  }

  /** Где игрок id (глаза, Babylon): свой — камера, напарник — аватар (или PlayerState). */
  private eyeOf(id: string | null): Vector3 | null {
    if (!id) return null;
    if (id === this.obsh.me()) return this.cam.position.clone();
    const a = this.deps.presence()?.shown.find((x) => x.id === id);
    if (a) return new Vector3(a.pos[0], a.pos[1], a.pos[2]);
    const s = this.co?.players.get(id)?.state;
    return s ? new Vector3(s.p[0], s.p[1], s.p[2]) : null;
  }

  /** События механики — у всех клиентов (хост — сразу, клиент — из среза). */
  private event(e: SmileEvent, map: SmileMap, nav: ObshNav | null) {
    const me = this.obsh.me();
    const near = (p: Vector3) => Vector3.Distance(p, this.cam.position) < SMILE_WALK.hearM;
    void map;
    switch (e.type) {
      case 'crunch':
        if (this.on) this.audio.crunch(this.world(e.p, 1.0, nav));
        break;
      case 'tear': {
        const s = this.cur();
        if (s?.chosen === me && this.model?.visible) this.audio.tear(this.model.headPos());
        break;
      }
      case 'pounce': {
        const s = this.cur();
        if (e.victim === me && this.on && !this.obsh.dead) this.startVictim(s);
        else if (this.on) {
          const p = this.eyeOf(e.victim);
          if (p && near(p)) this.audio.pounce(p);
        }
        break;
      }
      case 'eaten':
        if (e.victim === me && !this.obsh.dead) {
          const d = this.victim?.chosen ? SMILE_DEATH.eatenChosen : SMILE_DEATH.eaten;
          this.endVictim();
          this.obsh.kill(d.title, d.hint);
          this.audio.fade(false);
        }
        break;
      case 'trap': {
        const dd = e.door ? nav?.doorById.get(e.door) : null;
        const p = dd ? new Vector3(dd.x, dd.z + 1.1, -dd.y) : null;
        if (e.victim === me && this.on) {
          this.trapMe = { t: 0 };
          if (p) this.audio.creakShut(p, SMILE.trapCloseS);
        } else if (this.on && p && near(p)) this.audio.creakShut(p, SMILE.trapCloseS);
        break;
      }
      case 'trapDark':
        if (e.victim === me && this.on) this.audio.shatter();
        break;
      case 'trapEyes':
        if (e.victim === me && this.on) {
          this.obsh.hold(true);
          this.audio.laugh(SMILE.trapEyesS, () => this.eyesPos);
        }
        break;
      case 'trapChoke':
        if (e.victim === me && this.on) this.audio.choke(SMILE.trapChokeS);
        break;
      case 'trapDeath':
        if (e.victim === me && !this.obsh.dead) {
          this.trapMe = null;
          this.obsh.kill(SMILE_DEATH.trap.title, SMILE_DEATH.trap.hint);
          this.audio.fade(false);
        }
        break;
      case 'trapEscape':
        if (e.victim === me) {
          this.trapMe = null;
          this.obsh.hold(false);
        }
        break;
      default:
        break;
    }
  }

  /** Смена фазы (у всех): еда — звук; разорванная/провокация у избранного — стингер при первом взгляде (observe). */
  private phaseFx(v: SmileView) {
    const me = this.obsh.me();
    if (v.phase === 'eat' && v.eat) {
      if (v.eat.victim === me && this.on) this.audio.eat(SMILE.eatS);
      else if (this.on) {
        const p = this.eyeOf(v.eat.victim);
        if (p && Vector3.Distance(p, this.cam.position) < SMILE_WALK.hearM) this.audio.eat(SMILE.eatS, p);
      }
    }
    if (v.phase === 'peek' || v.phase === 'provoke') this.seenOnce = false;
  }

  // ───────────────────────── жертва ─────────────────────────

  private startVictim(s: SmileState | null) {
    const c = this.cam.position;
    // откуда кинулась: место провокации / выглядывания (не видел её — всё равно оттуда)
    const o = s?.at ? { x: s.at.p.x, y: s.at.p.y, z: s.at.z } : s?.spot ? { ...spotRoot(s.spot), z: s.spot.z } : null;
    const from = o ? new Vector3(o.x, o.z, -o.y) : this.model?.visible ? this.model.root.position.clone() : null;
    let dir = from ? from.subtract(c) : new Vector3(Math.sin(this.cam.rotation.y), 0, Math.cos(this.cam.rotation.y));
    dir.y = 0;
    if (dir.lengthSquared() < 1e-6) dir = new Vector3(Math.sin(this.cam.rotation.y), 0, Math.cos(this.cam.rotation.y));
    dir.normalize();
    const room = this.obsh.room();
    const floor = (room ? this.lastNav?.rooms.get(room)?.z : undefined) ?? c.y - 1.6;
    this.victim = { t: 0, lost: 0, from, chosen: s?.chosen === this.obsh.me(), dir, floor, yaw0: this.cam.rotation.y, eatT: 0 };
    this.obsh.hold(true);
    this.shake = 1.4;
    this.audio.sting();
    this.audio.pounce();
  }

  private endVictim() {
    if (!this.victim) return;
    this.victim = null;
    this.obsh.hold(false);
  }

  /** Камера жертвы: поворот к ней, бросок — в упор, потом на пол, взгляд на неё сверху. */
  private victimCam(dt: number, v: SmileView | null) {
    const vc = this.victim;
    if (!vc) return;
    vc.t += dt;
    const c = this.cam.position;
    // смотреть на неё
    const want = Math.atan2(vc.dir.x, vc.dir.z);
    let dy = want - this.cam.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.cam.rotation.y += dy * Math.min(1, dt * 14);
    this.cam.cameraDirection.setAll(0);
    if (v?.phase === 'eat') {
      vc.eatT += dt;
      // упал: глаза у пола, взгляд вверх на неё
      const k = smooth(vc.eatT / 0.45);
      c.y += (vc.floor + VICTIM_EYE - c.y) * Math.min(1, dt * 9) * (0.4 + 0.6 * k);
      const head = this.model?.visible ? this.model.headPos() : null;
      let pitch = -0.55;
      if (head) {
        const dx = head.x - c.x, dz = head.z - c.z, h = Math.hypot(dx, dz);
        pitch = -Math.atan2(head.y - c.y, Math.max(0.05, h));
      }
      this.cam.rotation.x += (pitch - this.cam.rotation.x) * Math.min(1, dt * 6);
      this.shake = Math.max(this.shake, 0.5 + 0.4 * Math.abs(Math.sin(this.time * 7.3)));
    } else {
      // бросок: взгляд — на её рот (чуть выше: пасть и глаза в кадре)
      const mouth = this.model?.visible ? this.model.mouthPos().scaleInPlace(0.7).addInPlace(this.model.headPos().scaleInPlace(0.3)) : null;
      let pitch = 0.02;
      if (mouth) {
        const dx = mouth.x - c.x, dz = mouth.z - c.z;
        pitch = -Math.atan2(mouth.y - c.y, Math.max(0.2, Math.hypot(dx, dz)));
      }
      this.cam.rotation.x += (pitch - this.cam.rotation.x) * Math.min(1, dt * 10);
      this.shake = Math.max(this.shake, 0.8);
    }
  }

  // ───────────────────────── ловушка ─────────────────────────

  /** Свет у жертвы ловушки: лампочки бьются (dark) — мигает и гаснет, дальше темно. */
  private trapLight(): number {
    const s = this.cur();
    const tr = s?.trap;
    if (!tr || tr.victim !== this.obsh.me() || !this.on) return 1;
    if (tr.ph === 'close') return 1;
    if (tr.ph === 'dark') {
      const u = SMILE.trapDarkS > 0 ? clamp01(tr.t / SMILE.trapDarkS) : 1;
      const blink = Math.sin(this.time * 61) > 0.2 ? 1 : 0.15;
      return Math.max(0.02, (1 - u) * blink);
    }
    return 0.02;
  }

  // ───────────────────────── картинка ─────────────────────────

  private ensureModel() {
    if (this.model) return;
    this.model = new SmileModel(this.scene, { seed: this.deps.seed });
    this.model.setVisible(false);
    this.eyes = new RedEyes(this.scene);
    this.spurt = new BloodSpurt(this.scene, { seed: this.deps.seed });
    const g = (this.glass = CreatePlane('smile:glass', { width: 0.53, height: 1.22 }, this.scene));
    const m = (this.glassMat = new StandardMaterial('smile:glassMat', this.scene));
    m.diffuseColor = new Color3(0.1, 0.14, 0.18);
    m.specularColor = new Color3(0.5, 0.55, 0.6);
    m.specularPower = 96;
    m.emissiveColor = new Color3(0.03, 0.045, 0.06);
    m.alpha = 0.32;
    m.backFaceCulling = false;
    g.material = m;
    g.layerMask = PORTAL_LAYER;
    g.isPickable = false;
    g.setEnabled(false);
  }

  private put(room: string | null | undefined, meshes: readonly Mesh[]) {
    if (!room) return;
    const l = this.draw.get(room);
    if (l) l.push(...meshes);
    else this.draw.set(room, [...meshes]);
  }

  private render(dt: number, v: SmileView | null, map: SmileMap, nav: ObshNav) {
    this.draw.clear();
    const me = this.obsh.me();
    const dead = this.obsh.dead;
    if (this.on || this.model) this.ensureModel();
    const chosen = !!v && v.chosen === me && this.on && !dead;
    const victimMe = !!v && !!v.eat && v.eat.victim === me && (v.phase === 'pounce' || v.phase === 'eat') && this.on && !dead;
    if (this.victim && (!victimMe || dead)) {
      // бросок сорвался (хост ушёл, срезов нет) или уже погиб
      this.victim.lost += dt;
      if (dead || this.victim.lost > 1) this.endVictim();
    } else if (this.victim) this.victim.lost = 0;
    if (victimMe && !this.victim) this.startVictim(this.cur());
    const show = !!v && v.visible && this.on && (chosen || victimMe);
    const model = this.model;
    if (model) {
      if (show && v) {
        this.place(model, v, victimMe, nav);
        model.setVisible(true);
        const rooms = this.modelRooms(v, map, nav, victimMe);
        for (const r of rooms) this.put(r, model.meshes);
      } else model.setVisible(false);
    }
    // стекло окна
    if (this.glass) {
      const win = show && v?.pose === 'window' && v.spot;
      this.glass.setEnabled(!!win);
      if (win && v?.spot) {
        const sp = v.spot;
        const ax = Math.cos(sp.yaw), ay = Math.sin(sp.yaw);
        this.glass.position.set(sp.p.x + ax * 0.008, sp.z + 1.54, -(sp.p.y + ay * 0.008));
        this.glass.rotation.y = yawB(sp.yaw);
        this.glass.computeWorldMatrix(true);
        this.put(sp.p.room, [this.glass]);
      }
    }
    // кровь из шеи жертвы — у всех, кроме неё
    if (this.spurt) {
      const e = v?.eat;
      const bleeding = !!v && !!e && e.victim !== me && this.on && (v.phase === 'eat' || (v.phase === 'pounce' && v.u > 0.8));
      let neck: Vector3 | null = null;
      if (bleeding && e) {
        const eye = this.eyeOf(e.victim);
        neck = eye ? eye.add(new Vector3(0, -0.17, 0)) : this.world(e.p, 1.4, nav);
      }
      const floorY = e ? e.z : undefined;
      this.spurt.frame(dt, neck, neck ? new Vector3(0.3 * Math.sin(this.time * 1.7), 1, 0.3 * Math.cos(this.time * 1.3)).normalize() : undefined, floorY);
      if (this.spurt.active && e) {
        const room = e.p.room ?? null;
        this.put(room, this.spurt.meshes);
        for (const o of (room ? map.rooms.get(room)?.open : null) ?? []) this.put(o.to, this.spurt.meshes);
      }
    }
    // красные зрачки — у жертвы ловушки
    const tr = v?.trap ?? null;
    const trapMe = !!tr && tr.victim === me && this.on && !dead;
    if (!trapMe && this.trapMe) {
      this.trapMe = null;
      if (!dead && !victimMe) this.obsh.hold(false);
    }
    if (trapMe && !this.trapMe) this.trapMe = { t: 0 };
    if (this.trapMe) this.trapMe.t += dt;
    if (this.eyes) {
      const on = trapMe && (tr!.ph === 'eyes' || tr!.ph === 'choke');
      if (on && tr) {
        const c = this.cam.position;
        const t = this.time;
        if (tr.ph === 'eyes') {
          const a = t * 1.9 + Math.sin(t * 0.83) * 1.6;
          const r = 1.25 + 0.45 * Math.sin(t * 1.31);
          this.eyesPos.set(c.x + Math.sin(a) * r, c.y + 0.05 + 0.18 * Math.sin(t * 2.3), c.z + Math.cos(a) * r);
        } else {
          // удушье: зрачки в упор перед лицом
          const f = new Vector3(Math.sin(this.cam.rotation.y), 0, Math.cos(this.cam.rotation.y));
          const k = SMILE.trapChokeS > 0 ? clamp01(tr.t / SMILE.trapChokeS) : 1;
          const d = 0.9 - 0.55 * smooth(k * 2);
          this.eyesPos.set(c.x + f.x * d, c.y - 0.02, c.z + f.z * d);
        }
        this.eyes.set(this.eyesPos, c, t);
        const room = this.obsh.room();
        this.put(room, this.eyes.meshes);
      } else this.eyes.set(null);
    }
    // камера жертвы, тряска
    if (victimMe) this.victimCam(dt, v);
    const shook = this.shake > 0;
    // тряска кренит камеру: «верх» — от поворота каждый кадр (как задумано в posture.ts; флаг в рантайме бывает сброшен —
    // тогда Babylon пересчитывает верх только при смене крена, вместе с наклоном взгляда, и горизонт потом заваливается)
    if (this.on || this.shake > 0 || victimMe) this.cam.updateUpVectorFromRotation = true;
    this.shake = dead ? 0 : Math.max(0, this.shake - dt * 1.1);
    if (trapMe && tr?.ph === 'choke') this.shake = Math.max(this.shake, 0.35);
    if (this.shake > 0) this.obsh.posture.roll = (Math.random() - 0.5) * 0.06 * this.shake;
    else if (shook) {
      // тряска кончилась: крен — ноль и «верх» камеры — мировой (Babylon пересчитал его на крене вместе с наклоном
      // взгляда; без поворота мышью он так бы и остался — горизонт заваливался бы при поворотах)
      this.obsh.posture.roll = 0;
      this.cam.upVector.set(0, 1, 0);
    }
    // звук: сердце и писк — у избранного; жертве — сердце в горле
    let heart = chosen && v ? v.heart : 0;
    const ring = chosen && v ? v.ring : 0;
    if (victimMe) heart = 1;
    if (trapMe && tr) heart = tr.ph === 'choke' ? 1 : tr.ph === 'eyes' ? 0.8 : tr.ph === 'dark' ? 0.6 : Math.max(heart, 0.35);
    this.audio.setHeart(heart);
    this.audio.setRing(ring);
    const c = this.cam.position;
    this.audio.update(c, this.cam.rotation.y, dt);
    this.overlayFrame(heart, victimMe, v, trapMe ? tr : null, dead);
  }

  /** Поставить модель по виду (план → Babylon), позу кадра. */
  private place(model: SmileModel, v: SmileView, victimMe: boolean, nav: ObshNav) {
    const root = model.root;
    let yaw = yawB(v.yaw);
    let pos: Vector3;
    let pounce: number | undefined;
    const side = v.spot?.side ?? 1;
    if ((v.pose === 'peek' || v.pose === 'window') && v.spot) {
      const r = spotRoot(v.spot);
      pos = new Vector3(r.x, v.spot.z, -r.y);
      yaw = yawB(v.spot.yaw);
    } else if (victimMe && this.victim && (v.pose === 'pounce' || v.pose === 'eat')) {
      const vc = this.victim;
      const c = this.cam.position;
      const d = vc.dir;
      yaw = Math.atan2(-d.x, -d.z);
      if (v.pose === 'pounce') {
        pounce = clamp01(v.lean);
        // к концу броска рот — в VICTIM_MOUTH_M перед глазами (ближе камера оказывается в голове), чуть ниже взгляда
        const reach = SMILE_MODEL.pounce.reach + VICTIM_MOUTH_M;
        const tgt = new Vector3(c.x + d.x * reach, c.y - SMILE_MODEL.pounce.mouthY - 0.06, c.z + d.z * reach);
        const from = vc.from ?? new Vector3(c.x + d.x * 3, vc.floor, c.z + d.z * 3);
        const k = smooth(pounce);
        pos = new Vector3(from.x + (tgt.x - from.x) * k, Math.max(vc.floor, from.y + (tgt.y - from.y) * k), from.z + (tgt.z - from.z) * k);
      } else {
        // над жертвой: шея жертвы — чуть впереди камеры на полу
        const nk = SMILE_MODEL.eat.neck;
        const nx = c.x + d.x * VICTIM_NECK_M, nz = c.z + d.z * VICTIM_NECK_M;
        // она обращена к камере (−dir): шея жертвы — у неё впереди на eat.neck.z
        pos = new Vector3(nx + d.x * nk.z, vc.floor, nz + d.z * nk.z);
      }
    } else if (v.pose === 'eat' && v.eat) {
      // над жертвой: рот у шеи (локально eat.neck), шея — где схватила
      const nk = SMILE_MODEL.eat.neck;
      const fx = Math.cos(v.yaw), fy = Math.sin(v.yaw);
      pos = new Vector3(v.eat.p.x - fx * nk.z, v.eat.z, -(v.eat.p.y - fy * nk.z));
    } else {
      pos = new Vector3(v.p!.x, v.z, -v.p!.y);
      if (v.pose === 'pounce') pounce = clamp01(v.lean);
    }
    root.position.copyFrom(pos);
    root.rotation.y = yaw;
    const lookEye = victimMe ? this.cam.position.clone() : this.eyeOf(v.look);
    model.setPose({ pose: v.pose ?? 'stand', lean: v.pose === 'pounce' ? 1 : v.lean, side, torn: v.torn, t: this.time, look: lookEye, ...(pounce !== undefined ? { pounce } : {}) });
    void nav;
  }

  /** Комнаты, в чьих проходах рисовать модель: где голова, где ступни, «её» комната и соседи жертвы. */
  private modelRooms(v: SmileView, map: SmileMap, nav: ObshNav, victimMe: boolean): Set<string> {
    const out = new Set<string>();
    const portal = this.obsh.portal();
    const floor = (id: string) => portal?.cache.peek(id)?.floor ?? null;
    const at = (x: number, y: number, hint: string | null | undefined) => {
      if (!hint) return;
      out.add(hint);
      const r = roomAt(nav, { x, y, room: hint }, floor);
      if (r) out.add(r);
    };
    if (victimMe) {
      const room = this.obsh.room();
      if (room) {
        out.add(room);
        for (const o of map.rooms.get(room)?.open ?? []) out.add(o.to);
      }
      return out;
    }
    const sp = v.spot;
    if (sp && (v.pose === 'peek' || v.pose === 'window')) {
      at(sp.p.x, sp.p.y, sp.p.room);
      const r = spotRoot(sp);
      at(r.x, r.y, sp.p.room);
      if (sp.hideRoom) out.add(sp.hideRoom);
      return out;
    }
    const p = v.eat && v.pose === 'eat' ? v.eat.p : v.p;
    if (p) {
      at(p.x, p.y, p.room ?? (v.eat?.p.room ?? null));
      if (v.eat?.p.room) out.add(v.eat.p.room);
    }
    return out;
  }

  /** Свой взгляд (избранный): видит ли голову модели (кадр + проёмы), в круге прицела ли; первый взгляд — стингер. */
  private observe(v: SmileView | null, nav: ObshNav) {
    const m = this.model;
    const me = this.obsh.me();
    let sees = false, aim = false;
    if (v && m && m.visible && v.chosen === me && this.on && !this.obsh.dead && v.phase !== 'gone' && v.lean > 0.3) {
      const head = m.headPos();
      const portal = this.obsh.portal();
      const hint = v.spot?.p.room ?? v.p?.room ?? this.obsh.room();
      const room = hint ? roomAt(nav, { x: head.x, y: -head.z, room: hint }, (id) => portal?.cache.peek(id)?.floor ?? null) : null;
      sees = !!room && this.obsh.seen(head, room);
      if (sees) {
        const pc = Vector3.TransformCoordinates(head, this.cam.getViewMatrix());
        if (pc.z > 0.05) {
          const off = Math.hypot(pc.x / pc.z, pc.y / pc.z);
          aim = off <= SMILE.aimCircle * Math.tan(this.cam.fov / 2) + 0.1 / pc.z;
        }
      }
    }
    this.sees = sees;
    this.aim = aim;
    // первый взгляд на близкую (стадия 2+) — стингер
    if (sees && !this.seenOnce && v && v.stage >= 2) {
      this.seenOnce = true;
      this.audio.sting();
    }
  }

  // ───────────────────────── оверлей ─────────────────────────

  private ensureOverlay() {
    if (this.overlay) return this.overlay;
    const parent = this.scene.getEngine().getRenderingCanvas()?.parentElement;
    if (!parent) return null;
    const mk = (css: string) => {
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;inset:0;pointer-events:none;opacity:0;${css}`;
      return d;
    };
    const root = mk('opacity:1;z-index:3;overflow:hidden;');
    root.className = 'smile-overlay';
    const pulse = mk('background:radial-gradient(ellipse at center, rgba(120,0,0,0) 38%, rgba(120,0,0,0.55) 72%, rgba(70,0,0,0.95) 100%);');
    const veil = mk('background:radial-gradient(ellipse at center, rgba(150,0,0,0) 25%, rgba(110,0,0,0.6) 70%, rgba(40,0,0,0.95) 100%);');
    const black = mk('background:#000;');
    root.append(pulse, veil, black);
    parent.appendChild(root);
    this.overlay = { root, pulse, veil, black };
    return this.overlay;
  }

  /** Красная пульсация в такт сердцу, пелена жертвы, затемнение удушья. */
  private overlayFrame(heart: number, victimMe: boolean, v: SmileView | null, tr: SmileState['trap'], dead: boolean) {
    const want = this.on && !dead && (heart > 0.3 || victimMe || !!tr);
    if (!want && !this.overlay) return;
    const o = this.ensureOverlay();
    if (!o) return;
    if (!want) {
      o.pulse.style.opacity = o.veil.style.opacity = o.black.style.opacity = '0';
      return;
    }
    // удар: короткий подъём и спад на каждом ударе (темп — как у звука сердца)
    const bpm = heartBpm(heart);
    const ph = (this.time * bpm) / 60;
    const f = ph - Math.floor(ph);
    const beat = Math.exp(-f * 9) + 0.6 * Math.exp(-Math.max(0, f - 0.18) * 11) * (f > 0.18 ? 1 : 0);
    // жертва броска видит её в упор — пульсация слабее (не заливать лицо)
    const amp = clamp01((heart - 0.3) / 0.7) * (victimMe ? 0.55 : 1);
    o.pulse.style.opacity = (amp * (0.25 + 0.75 * clamp01(beat))).toFixed(3);
    let veil = 0;
    if (victimMe && v) veil = v.phase === 'eat' ? 0.45 + 0.4 * clamp01(v.u) : 0.3 * clamp01(v.u);
    o.veil.style.opacity = veil.toFixed(3);
    let black = 0;
    if (tr?.ph === 'choke') black = SMILE.trapChokeS > 0 ? smooth(tr.t / SMILE.trapChokeS) * 0.92 : 0.92;
    if (victimMe && v?.phase === 'eat') black = Math.max(black, 0.9 * smooth((clamp01(v.u) - 0.7) / 0.3));
    o.black.style.opacity = black.toFixed(3);
  }

  // ───────────────────────── кооп ─────────────────────────

  private fx(from: string, k: string, d: unknown) {
    const co = this.co;
    if (!co) return;
    if (k === 'smile') {
      if (co.isHost) return;
      const w = d as SmileWire | null;
      if (!w || typeof w.q !== 'number' || !okState(w.s)) return;
      if (this.remote && from === this.remote.from && w.q <= this.remote.q) return;
      this.remote = { s: w.s, at: performance.now(), from, q: w.q };
      this.st = null;
      for (const e of Array.isArray(w.e) ? w.e : []) if (e && typeof e.type === 'string') this.event(e, this.lastMap!, this.lastNav);
      return;
    }
    if (k === 'smileMe' && co.isHost) {
      const o = d as { f?: unknown; s?: unknown; a?: unknown } | null;
      this.reports.set(from, { at: performance.now(), f: !!o?.f, s: !!o?.s, a: !!o?.a });
    }
  }

  private coopSend() {
    const co = this.co;
    if (!co || co.status !== 'online') return;
    const now = performance.now();
    if (now - this.sentAt < SMILE_WALK.sendMs) return;
    this.sentAt = now;
    if (co.isHost && this.st) {
      const anyone = this.on || [...co.players.values()].some((p) => !!p.state?.room && !!this.lastNav?.rooms.get(p.state.room)?.obsh);
      if (!anyone && !this.wireEv.length) return;
      let w: SmileWire = { q: ++this.wireQ, s: this.st, e: this.wireEv };
      if (JSON.stringify(w).length > 1900) w = { q: w.q, s: { ...this.st, rooms: this.st.rooms.slice(-2) }, e: this.wireEv.filter((e) => e.type !== 'peek' && e.type !== 'hide').slice(-4) };
      co.fx('smile', w);
      this.wireEv = [];
    } else if (!co.isHost && this.on && !this.obsh.dead) {
      co.fx('smileMe', { f: isFlash(this.deps.held()) ? 1 : 0, s: this.sees ? 1 : 0, a: this.aim ? 1 : 0 });
    }
  }

  // ───────────────────────── уход, QA ─────────────────────────

  private leave() {
    this.audio.setHeart(0);
    this.audio.setRing(0);
    this.audio.fade(false);
    this.model?.setVisible(false);
    this.eyes?.set(null);
    this.spurt?.clear();
    this.draw.clear();
    if (this.victim) this.endVictim();
    this.trapMe = null;
    if (this.overlay) this.overlay.pulse.style.opacity = this.overlay.veil.style.opacity = this.overlay.black.style.opacity = '0';
  }

  /** Хуки для браузерных проверок (window.__rfSmile). */
  qa() {
    const self = this;
    return {
      /** ручки механики (изменяемый объект SMILE) */
      cfg: () => SMILE,
      state: () => JSON.parse(JSON.stringify(self.cur())) as SmileState | null,
      view: () => {
        const s = self.cur();
        return s ? smileView(s) : null;
      },
      /** охота сейчас со стадии stage (идёт — сначала сброс) */
      force(stage: 1 | 2 | 3 = 1): boolean {
        if (!self.obsh.isAuthority()) return false;
        if (!self.st) self.adopt();
        if (self.st!.stage !== 0 || self.st!.trap) self.st = createSmile(`${self.deps.seed}/smile/qa${Math.round(self.time * 1000)}`);
        return forceSmile(self.st!, stage);
      },
      /** без естественных охот (только force) */
      calm(on = true) {
        self.qaCalm = on;
        if (on && self.st && self.st.stage === 0) self.st.next = 1e9;
      },
      /** фаза — сразу к концу (следующая по механике на следующем кадре) */
      skip() {
        const s = self.st;
        if (s && s.phaseDur > 0) s.phaseT = Math.max(0, s.phaseDur - 1e-3);
        else if (s && s.phase === 'idle') s.next = 0;
      },
      /** ловушка на себя (соло её не бывает): стоишь внутри жилой комнаты — дверь закрывается, дальше по механике */
      trap(): boolean {
        const map = self.lastMap, room = self.obsh.room();
        if (!self.obsh.isAuthority() || !map || !room) return false;
        if (!self.st) self.adopt();
        const c = self.cam.position;
        const inside = insideDorm(map, { x: c.x, y: -c.z, room });
        if (!inside || self.st!.trap) return false;
        const door = map.doorsByRoom.get(inside)?.find((d) => d.room === inside)?.id ?? null;
        const me = self.obsh.me();
        self.st!.trap = { victim: me, room: inside, door, ph: 'close', t: 0 };
        const e: SmileEvent = { type: 'trap', victim: me, room: inside, door };
        self.hostEvent(e, map);
        self.event(e, map, self.lastNav);
        return true;
      },
      chosen: () => self.cur()?.chosen ?? null,
      me: () => ({ id: self.obsh.me(), sees: self.sees, aim: self.aim, on: self.on, victim: !!self.victim, trap: !!self.trapMe }),
      /** кандидаты выглядывания для своего игрока */
      spots() {
        const map = self.lastMap, room = self.obsh.room();
        if (!map || !room) return [];
        const c = self.cam.position, yaw = self.cam.rotation.y;
        const s = self.cur();
        // как у механики: двери, запертые не ею (ключ), — не её
        return smileSpots(map, { p: { x: c.x, y: -c.z, room }, fx: Math.sin(yaw), fy: -Math.cos(yaw) }, { locked: (id) => !!self.obsh.lockedMsg(id) && !(s && smileLocked(s, id)) });
      },
      model: () => (self.model ? { visible: self.model.visible, root: self.model.root.position.asArray(), yaw: self.model.root.rotation.y, head: self.model.visible ? self.model.headPos().asArray() : null, rooms: [...self.draw.keys()] } : null),
      audio: () => ({ ...self.audio.counters, running: self.audio.running }),
    };
  }

  dispose() {
    this.leave();
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    this.obs = null;
    const h = this.obsh.hooks;
    const drop = <T>(l: T[], f: T) => {
      const i = l.indexOf(f);
      if (i >= 0) l.splice(i, 1);
    };
    drop(h.locked, this.hooks.locked);
    drop(h.light, this.hooks.light);
    drop(h.silent, this.hooks.silent);
    this.extrasOf?.extraProviders.delete(this.extrasFn);
    this.extrasOf = null;
    this.deps.co?.onFx.delete(this.onFxFn);
    window.removeEventListener('keydown', this.onGesture);
    window.removeEventListener('pointerdown', this.onGesture);
    this.model?.dispose();
    this.eyes?.dispose();
    this.spurt?.dispose();
    this.glass?.dispose();
    this.glassMat?.dispose();
    this.audio.dispose();
    this.overlay?.root.remove();
    this.overlay = null;
  }
}
