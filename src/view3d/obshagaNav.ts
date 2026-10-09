// «Общага» в «Прогулке» (docs/LOCATIONS.md, «Общага: двери, темнота, рука, лампа»): навигация без движка — двери комнат,
// граф комнат по проёмам, путь руки, двери появления, споты керосиновых ламп. Механика руки (src/locations/obshaga.ts)
// путей не ищет: интеграция подаёт ей ближайшую точку пути кончика (goal), видимую по прямой, и двери появления.
//
// Координаты — план прогона, метры (x вправо, y вниз), как у Pt механики. Карта руки — одна: граф без швов бесконечного
// хода (Link.wrap — за швом план сдвинут) и без лестничных залов (марш меняет высоту пола — рука в них не заходит; игрок
// за лестницей — вне карты руки), только комнаты общаги. В пределах карты (до CHART_HOPS дверей) план непрерывен.
import type { RunExport, RunInstance, Side } from '../blockout/types';
import { isProtected, type Pt, type SpawnCandidate } from '../locations/obshaga';

/** Метки дверей комнат общаги со стороны коридора (полотна здесь нет) и со стороны комнаты (полотно здесь). */
export const OBSH_SIDE_TAGS: ReadonlySet<string> = new Set(['obshaga>room', 'obshaga>common', 'hall>vahter']);
export const OBSH_LEAF_TAGS: ReadonlySet<string> = new Set(['room>obshaga', 'common>obshaga', 'vahter>hall']);
/** Дверь комнаты общаги — эта модель (src/blockout/doors.ts). */
export const OBSH_DOOR_STYLE = 'obshaga_room';
/** Карта руки: дверей от корня, не больше. */
export const CHART_HOPS = 14;
/** Проём (кончик у него) пройден, если ближе стольких метров. */
export const REACH_M = 0.3;
/** Проём двери появления: от плоскости стены в коридор, м (коридор 2 м — середина). */
export const MOUTH_M = 1.0;
/** Точка за дверью (корень руки): от плоскости стены в комнату, м. */
export const BEHIND_M = 0.7;

export interface NavEdge {
  to: string;
  /** середина проёма (между метками двух комнат), план, м */
  x: number;
  y: number;
}

export interface NavRoom {
  id: string;
  /** высота низа комнаты, м (RunInstance.z — за лестницами мир выше/ниже) */
  z: number;
  /** комната общаги (первый тег «общага») */
  obsh: boolean;
  /** лестничный зал (тег «лестница») — пол на двух уровнях */
  stair: boolean;
  /** вода по пояс (тег «затоплено») */
  flooded: boolean;
  /** вестибюль с вахтой (тег «вахта») — место возрождения */
  hub: boolean;
  /** рамка пола, м */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  edges: NavEdge[];
}

/** Дверь комнаты общаги (самозакрывающаяся): id — «inst/connector» полотна (как ключ BabylonBlockout.doorLeaves). */
export interface ObshDoor {
  id: string;
  /** полотно: экземпляр и метка (у связанной — комната, у запертой — коридор) */
  inst: string;
  conn: string;
  /** сторона коридора (у запертой — тот же inst) */
  cor: string;
  /** комната за дверью; null — заперта (за ней глухая стена) */
  room: string | null;
  /** середина проёма, план, м: у связанной — между метками, у запертой — на грани стены коридора */
  x: number;
  y: number;
  /** единичная нормаль из проёма в коридор */
  nx: number;
  ny: number;
  /** пол коридора у двери, м */
  z: number;
  widthM: number;
}

/** Спот керосиновой лампы, на котором она ещё стоит. */
export interface LampSpot {
  inst: string;
  spot: string;
  /** план, м */
  x: number;
  y: number;
  /** пол комнаты, м */
  z: number;
}

/** Откуда может вылезти рука: дверь комнаты общаги или (в затопленном подвале, где дверей нет) темнота хода за проёмом. */
export interface SpawnPoint {
  /** id — у двери её id (ключ полотна), у хода — «pass:откуда>куда» */
  id: string;
  /** корень руки (за дверью / в глубине соседнего куска хода) и проём, где она вылезает */
  door: Pt;
  mouth: Pt;
  /** комната проёма (её должна содержать карта игрока) */
  cor: string;
  /** точки для взгляда «смотрят ли сюда» (план; h — высота над полом комнаты) */
  look: { x: number; y: number; room: string; h: number }[];
  /** дверь (null — ход подвала) */
  doorRef: ObshDoor | null;
}

export interface ObshNav {
  rooms: Map<string, NavRoom>;
  doors: ObshDoor[];
  doorById: Map<string, ObshDoor>;
  /** двери по комнатам (и коридора, и комнаты за дверью) */
  doorsByRoom: Map<string, ObshDoor[]>;
  /** откуда может вылезти рука (двери и ходы подвала) — по комнатам проёма и корня */
  spawns: SpawnPoint[];
  spawnsByRoom: Map<string, SpawnPoint[]>;
  lamps: LampSpot[];
}

const SIDE_N: Record<Side, [number, number]> = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] };

/** Нормаль метки внутрь её комнаты (план). */
export function sideNormal(side: Side): [number, number] {
  return SIDE_N[side] ?? [0, 1];
}

const navCache = new WeakMap<RunExport, ObshNav>();

/** Навигация по прогону (кэш по объекту прогона: мир вырос — новый прогон, новая навигация). */
export function navOf(rx: RunExport): ObshNav {
  let n = navCache.get(rx);
  if (!n) navCache.set(rx, (n = buildNav(rx)));
  return n;
}

export function buildNav(rx: RunExport): ObshNav {
  const c = rx.cellM > 0 ? rx.cellM : 0.1;
  const byId = new Map<string, RunInstance>();
  for (const i of rx.instances) byId.set(i.id, i);
  const conn = new Map<string, RunInstance['connectors'][number]>();
  for (const i of rx.instances) for (const k of i.connectors ?? []) conn.set(`${i.id}/${k.id}`, k);
  const mid = (k: { line: [number, number, number, number] }): [number, number] => [((k.line[0] + k.line[2]) / 2) * c, ((k.line[1] + k.line[3]) / 2) * c];
  const rooms = new Map<string, NavRoom>();
  for (const i of rx.instances) {
    const tags = i.roomTags ?? [];
    const b = i.bbox;
    rooms.set(i.id, {
      id: i.id,
      z: Number(i.z) || 0,
      obsh: tags[0] === 'общага',
      stair: tags.includes('лестница'),
      flooded: tags.includes('затоплено'),
      hub: tags.includes('вахта'),
      x0: b.x0 * c,
      y0: b.y0 * c,
      x1: b.x1 * c,
      y1: b.y1 * c,
      edges: [],
    });
  }
  for (const l of rx.links ?? []) {
    if (l.wrap || l.sealed || (l.kind && l.kind !== 'door')) continue;
    const ka = conn.get(`${l.a.inst}/${l.a.connector}`), kb = conn.get(`${l.b.inst}/${l.b.connector}`);
    const ra = rooms.get(l.a.inst), rb = rooms.get(l.b.inst);
    if (!ka || !kb || !ra || !rb) continue;
    const [ax, ay] = mid(ka), [bx, by] = mid(kb);
    const x = (ax + bx) / 2, y = (ay + by) / 2;
    ra.edges.push({ to: rb.id, x, y });
    rb.edges.push({ to: ra.id, x, y });
  }
  const doors: ObshDoor[] = [];
  for (const i of rx.instances) {
    if ((i.roomTags ?? [])[0] !== 'общага') continue;
    for (const k of i.connectors ?? []) {
      if (k.len < 1) continue;
      const [mx, my] = mid(k);
      const [nx, ny] = sideNormal(k.side);
      if (OBSH_LEAF_TAGS.has(k.tag)) {
        // полотно в комнате; дверь — если комната связана с коридором
        const to = k.linkedTo;
        const other = to ? conn.get(`${to.inst}/${to.connector}`) : null;
        if (!to || !other || !byId.has(to.inst)) continue;
        const [ox, oy] = mid(other);
        doors.push({
          id: `${i.id}/${k.id}`, inst: i.id, conn: k.id, cor: to.inst, room: i.id,
          x: (mx + ox) / 2, y: (my + oy) / 2, nx: -nx, ny: -ny,
          z: rooms.get(to.inst)?.z ?? 0, widthM: k.len * c,
        });
      } else if (OBSH_SIDE_TAGS.has(k.tag)) {
        // связанная — уже со стороны комнаты; не раскрытая (cut) и выходы — не двери; иначе заперта: полотно в коридоре
        if (k.linkedTo || k.cut || k.exit || k.arrival || k.collapsed) continue;
        doors.push({
          id: `${i.id}/${k.id}`, inst: i.id, conn: k.id, cor: i.id, room: null,
          x: mx, y: my, nx, ny, z: rooms.get(i.id)?.z ?? 0, widthM: k.len * c,
        });
      }
    }
  }
  const doorById = new Map(doors.map((d) => [d.id, d] as const));
  const doorsByRoom = new Map<string, ObshDoor[]>();
  const put = (r: string, d: ObshDoor) => {
    const l = doorsByRoom.get(r);
    if (l) l.push(d);
    else doorsByRoom.set(r, [d]);
  };
  for (const d of doors) {
    put(d.cor, d);
    if (d.room && d.room !== d.cor) put(d.room, d);
  }
  const lamps: LampSpot[] = [];
  for (const i of rx.instances) {
    for (const s of i.spots ?? []) {
      if (!s.id.endsWith('_s_lantern') || s.content?.kind !== 'prop' || s.content.id !== 'p_obsh_lantern') continue;
      lamps.push({ inst: i.id, spot: s.id, x: s.x * c, y: s.y * c, z: Number(i.z) || 0 });
    }
  }
  // откуда может вылезти рука: двери комнат и — в затопленном подвале, где дверей нет, — темнота соседнего куска хода
  const spawns: SpawnPoint[] = [];
  for (const d of doors) {
    const { door, mouth } = doorPoints(d);
    const lx = d.room ? -d.nx : d.nx, ly = d.room ? -d.ny : d.ny;
    spawns.push({
      id: d.id, door, mouth, cor: d.cor, doorRef: d,
      look: [{ x: d.x + lx * 0.12, y: d.y + ly * 0.12, room: d.inst, h: 1.0 }, { x: d.x + lx * 0.45, y: d.y + ly * 0.45, room: d.inst, h: 1.5 }],
    });
  }
  for (const a of rooms.values()) {
    if (!a.flooded || a.stair || !a.obsh) continue;
    for (const e of a.edges) {
      const b = rooms.get(e.to);
      if (!b || !b.flooded || b.stair || !b.obsh) continue;
      // рука из куска b в кусок a: корень — в глубине b по оси прохода (до 2.5 м), проём — у самого стыка (0.1 м в a)
      const bx = (b.x0 + b.x1) / 2, by = (b.y0 + b.y1) / 2;
      let ux = e.x - bx, uy = e.y - by;
      if (Math.abs(ux) >= Math.abs(uy)) (ux = Math.sign(ux) || 1), (uy = 0);
      else (uy = Math.sign(uy) || 1), (ux = 0);
      const depth = Math.max(0.3, Math.min(2.5, ux > 0 ? e.x - (b.x0 + 0.2) : ux < 0 ? b.x1 - 0.2 - e.x : uy > 0 ? e.y - (b.y0 + 0.2) : b.y1 - 0.2 - e.y));
      spawns.push({
        id: `pass:${b.id}>${a.id}`,
        door: { x: e.x - ux * depth, y: e.y - uy * depth, room: b.id },
        mouth: { x: e.x + ux * 0.1, y: e.y + uy * 0.1, room: a.id },
        cor: a.id,
        doorRef: null,
        look: [{ x: e.x + ux * 0.6, y: e.y + uy * 0.6, room: a.id, h: 1.0 }, { x: e.x - ux * 0.5, y: e.y - uy * 0.5, room: b.id, h: 1.0 }],
      });
    }
  }
  const spawnsByRoom = new Map<string, SpawnPoint[]>();
  const putS = (r: string, sp: SpawnPoint) => {
    const l = spawnsByRoom.get(r);
    if (l) {
      if (!l.includes(sp)) l.push(sp);
    } else spawnsByRoom.set(r, [sp]);
  };
  for (const sp of spawns) {
    putS(sp.cor, sp);
    if (sp.door.room) putS(sp.door.room, sp);
  }
  return { rooms, doors, doorById, doorsByRoom, spawns, spawnsByRoom, lamps };
}

// ───────────────────────── карта и путь ─────────────────────────

/** Может ли рука быть в комнате: общага, не лестница. */
export function handRoom(r: NavRoom | undefined): boolean {
  return !!r && r.obsh && !r.stair;
}

/** Карта руки от root: комнаты общаги без лестниц в пределах maxHops дверей (BFS), → число дверей. root — всегда. */
export function chartOf(nav: ObshNav, root: string, maxHops = CHART_HOPS): Map<string, number> {
  const out = new Map<string, number>();
  if (!nav.rooms.has(root)) return out;
  out.set(root, 0);
  const q = [root];
  for (let k = 0; k < q.length; k++) {
    const id = q[k];
    const h = out.get(id)!;
    if (h >= maxHops) continue;
    for (const e of nav.rooms.get(id)!.edges) {
      if (out.has(e.to) || !handRoom(nav.rooms.get(e.to))) continue;
      out.set(e.to, h + 1);
      q.push(e.to);
    }
  }
  return out;
}

/** Кратчайший (по числу дверей) путь комнат from → to внутри allowed; null — нет. */
export function roomPath(nav: ObshNav, from: string, to: string, allowed: { has(id: string): boolean }): string[] | null {
  if (from === to) return [from];
  if (!allowed.has(from) || !allowed.has(to)) return null;
  const prev = new Map<string, string>([[from, '']]);
  const q = [from];
  for (let k = 0; k < q.length; k++) {
    const id = q[k];
    for (const e of nav.rooms.get(id)?.edges ?? []) {
      if (prev.has(e.to) || !allowed.has(e.to)) continue;
      prev.set(e.to, id);
      if (e.to === to) {
        const path = [to];
        for (let x = id; x; x = prev.get(x)!) path.push(x);
        return path.reverse();
      }
      q.push(e.to);
    }
  }
  return null;
}

/** Проём между соседними комнатами a и b (план), null — не соседи. */
export function edgeBetween(nav: ObshNav, a: string, b: string): NavEdge | null {
  return nav.rooms.get(a)?.edges.find((e) => e.to === b) ?? null;
}

/**
 * Точки пути по комнатам path к цели to: середины проёмов (метка — комната, ИЗ которой к проёму идут: кончик меняет
 * комнату, только пройдя проём), затем сама цель (метка — её комната).
 */
export function waypoints(nav: ObshNav, path: readonly string[], to: Pt): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const e = edgeBetween(nav, path[i], path[i + 1]);
    if (e) out.push({ x: e.x, y: e.y, room: path[i] });
  }
  out.push({ x: to.x, y: to.y, room: path[path.length - 1] });
  return out;
}

/** Длина ломаной from → pts, м. */
export function polyLength(from: Pt, pts: readonly Pt[]): number {
  let s = 0;
  let a = from;
  for (const b of pts) {
    s += Math.hypot(b.x - a.x, b.y - a.y);
    a = b;
  }
  return s;
}

/** Следующая точка пути: первая дальше reach от кончика (пройденные проёмы пропускаются); null — пришли. */
export function nextGoal(tip: Pt, pts: readonly Pt[], reach = REACH_M): Pt | null {
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const last = i === pts.length - 1;
    if (Math.hypot(p.x - tip.x, p.y - tip.y) > (last ? 1e-3 : reach)) return { ...p };
  }
  return null;
}

/** Лежит ли точка в рамке комнаты (с запасом pad на половины проёмов и стены), м. */
export function inRoomBox(r: NavRoom, x: number, y: number, pad = 0.15): boolean {
  return x > r.x0 - pad && x < r.x1 + pad && y > r.y0 - pad && y < r.y1 + pad;
}

/**
 * Комната точки: hint (если точка в нём) или сосед hint, в чьём полу она лежит; иначе hint. floor — пол куска
 * портального рендера (с половинами проёмов), если построен; иначе рамка экземпляра.
 */
export function roomAt(nav: ObshNav, p: Pt, floor?: (id: string) => readonly { x0: number; y0: number; x1: number; y1: number }[] | null): string | null {
  const hint = p.room ?? null;
  const r = hint ? nav.rooms.get(hint) : undefined;
  if (!r) return hint;
  const inside = (id: string): boolean => {
    const f = floor?.(id);
    if (f && f.length) return f.some((q) => p.x > q.x0 && p.x < q.x1 && p.y > q.y0 && p.y < q.y1);
    const rr = nav.rooms.get(id);
    return !!rr && inRoomBox(rr, p.x, p.y, 0.05);
  };
  if (inside(r.id)) return r.id;
  // внутри рамки подсказки (не на её полу: колонна, будка вахтёра посреди зала, витки душевой) — всё ещё она: рука
  // идёт сквозь препятствие своей комнаты, а не «заходит» в комнату внутри неё
  if (inRoomBox(r, p.x, p.y, -0.05)) return r.id;
  for (const e of r.edges) if (inside(e.to)) return e.to;
  return r.id;
}

// ───────────────────────── рука: цель и двери появления ─────────────────────────

export interface NavPlayer {
  id: string;
  p: Pt;
  /** несёт лампу */
  protected: boolean;
  /** куда смотрит (план, единичный вектор) — для «сзади или сбоку»; нет — неизвестно */
  fx?: number;
  fy?: number;
}

/**
 * Цель кончика руки: ближайший по пути незащищённый игрок (не с лампой и не в поле ламп) в карте allowed; таких нет —
 * ближайший защищённый (рука ползёт к нему до края поля: видна в свете лампы, замирает, от лампы уползает). goal —
 * следующая точка пути (видна из кончика по прямой: комнаты выпуклые), null — стоять (никого нет в карте); dist — путь
 * до цели, м; open — цель не защищена.
 */
export function handGoal(
  nav: ObshNav, tip: Pt, players: readonly NavPlayer[], lanterns: readonly Pt[], allowed: { has(id: string): boolean },
  floor?: (id: string) => readonly { x0: number; y0: number; x1: number; y1: number }[] | null,
): { goal: Pt | null; target: string | null; dist: number; open: boolean } {
  const from = roomAt(nav, tip, floor);
  type Best = { goal: Pt | null; target: string | null; dist: number; open: boolean };
  let open: Best = { goal: null, target: null, dist: Infinity, open: true };
  let prot: Best = { goal: null, target: null, dist: Infinity, open: false };
  if (!from) return open;
  for (const pl of players) {
    if (!pl.p.room) continue;
    const path = roomPath(nav, from, pl.p.room, allowed);
    if (!path) continue;
    const wps = waypoints(nav, path, pl.p);
    const d = polyLength(tip, wps);
    const isOpen = !pl.protected && !isProtected(pl.p, lanterns);
    const best = isOpen ? open : prot;
    if (d < best.dist || (d === best.dist && best.target !== null && pl.id < best.target)) {
      const b = { goal: nextGoal(tip, wps), target: pl.id, dist: d, open: isOpen };
      if (isOpen) open = b;
      else prot = b;
    }
  }
  return open.target !== null ? open : prot;
}

/** Точки двери появления: корень за дверью (в комнате; у запертой — за стеной) и проём в коридоре. */
export function doorPoints(d: ObshDoor): { door: Pt; mouth: Pt } {
  return {
    door: { x: d.x - d.nx * BEHIND_M, y: d.y - d.ny * BEHIND_M, room: d.room ?? d.cor },
    mouth: { x: d.x + d.nx * MOUTH_M, y: d.y + d.ny * MOUTH_M, room: d.cor },
  };
}

/**
 * Откуда может вылезти рука: двери общаги и ходы подвала (SpawnPoint) в карте (maxHops дверей) хоть одного игрока;
 * dist — путь от проёма до ближайшего игрока (≤ maxDist); seen — туда смотрит кто-то; inField — проём в поле лампы;
 * facing — косинус между взглядом ближайшего игрока и направлением на проём (1 — перед глазами, −1 — за спиной).
 */
export function spawnCandidates(
  nav: ObshNav, players: readonly NavPlayer[], seen: ReadonlySet<string>, lanterns: readonly Pt[],
  opts: { maxHops?: number; maxDist?: number } = {},
): SpawnCandidate[] {
  const maxHops = opts.maxHops ?? 10;
  const maxDist = opts.maxDist ?? 40;
  const charts = players.filter((p) => p.p.room && handRoom(nav.rooms.get(p.p.room))).map((p) => ({ p, chart: chartOf(nav, p.p.room!, maxHops) }));
  const out: SpawnCandidate[] = [];
  const done = new Set<string>();
  for (const { chart } of charts) {
    for (const room of chart.keys()) {
      for (const sp of nav.spawnsByRoom.get(room) ?? []) {
        if (done.has(sp.id) || sp.cor !== room) continue;
        done.add(sp.id);
        // корень руки — не там, где стоит игрок (из его же комнаты рука не растёт)
        if (sp.door.room && sp.door.room !== sp.cor && charts.some((c) => c.p.p.room === sp.door.room)) continue;
        const { door, mouth } = sp;
        let dist = Infinity;
        let near: NavPlayer | null = null;
        for (const c of charts) {
          if (!c.chart.has(sp.cor)) continue;
          const path = roomPath(nav, sp.cor, c.p.p.room!, c.chart);
          if (!path) continue;
          const d = polyLength(mouth, waypoints(nav, path, c.p.p));
          if (d < dist) (dist = d), (near = c.p);
        }
        if (!(dist <= maxDist) || !near) continue;
        let facing: number | undefined;
        if (typeof near.fx === 'number' && typeof near.fy === 'number') {
          const dx = mouth.x - near.p.x, dy = mouth.y - near.p.y, l = Math.hypot(dx, dy);
          facing = l > 1e-6 ? Math.round(((dx * near.fx + dy * near.fy) / l) * 100) / 100 : 0;
        }
        out.push({ id: sp.id, door: { ...door }, mouth: { ...mouth }, dist: Math.round(dist * 100) / 100, seen: seen.has(sp.id), inField: isProtected(mouth, lanterns), ...(facing !== undefined ? { facing } : {}) });
      }
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Ближайший по дверям вестибюль с вахтой от комнаты from (по всему миру, без швов); null — нет. */
export function nearestHub(nav: ObshNav, from: string, maxHops = 400): string | null {
  if (!nav.rooms.has(from)) return null;
  const seen = new Map<string, number>([[from, 0]]);
  const q = [from];
  for (let k = 0; k < q.length; k++) {
    const id = q[k];
    const r = nav.rooms.get(id)!;
    if (r.hub && r.obsh) return id;
    const h = seen.get(id)!;
    if (h >= maxHops) continue;
    for (const e of r.edges) {
      if (seen.has(e.to)) continue;
      seen.set(e.to, h + 1);
      q.push(e.to);
    }
  }
  return null;
}

/** Зона хода полотна (план): точка ближе (ширина полотна + r) к петлям со стороны комнаты полотна или в самом проёме. */
export function inSwing(
  hinge: { x: number; y: number }, leafDir: { x: number; y: number }, roomN: { x: number; y: number }, width: number, p: { x: number; y: number }, r = 0.4,
): boolean {
  const dx = p.x - hinge.x, dy = p.y - hinge.y;
  const t = dx * leafDir.x + dy * leafDir.y;
  const n = dx * roomN.x + dy * roomN.y;
  if (n < -0.35 || t < -r) return false;
  return Math.hypot(t, Math.max(0, n)) < width + r;
}
