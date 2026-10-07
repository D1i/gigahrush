// Генератор раскладки и розыгрыш наполнения (ТЗ: прогон, экземпляр; экономика — элитность).
// Алгоритм и порядок обращений к ГСЧ описаны в docs/GENERATOR.md — движок повторяет их дословно.
import { OPPOSITE, parseKey, rotateCell, rotatePoint, SIDE_DELTA } from '../model/cells';
import { finishRuleFor, finishRuleWeights } from '../model/ops';
import { makeRng, type Rng } from '../model/rng';
import { segmentMid } from '../model/segments';
import type {
  Assign,
  CellKey,
  Connector,
  FinishSurface,
  GeneratorSettings,
  Instance,
  InstanceContent,
  Link,
  Pass,
  Project,
  Room,
  Rot,
  Run,
  RunStop,
  SpawnedLoot,
  SpawnedSpot,
  Tier,
} from '../model/types';
import { compatible, dockTarget, facing, normDeg, rotFor, transformSeg } from './geom';
import { CellGrid } from './grid';
import { PORTAL, portalOf, scanSight, seedsWithinLimit, sightLimits, type EdgeSet, type OwnerFn, type SightResult } from './sight';
import { WalkRoll, walkWarning, type ContentGroup } from './walk';

// ───────────────────────── Упаковка клеток в число ─────────────────────────
// Ключ (x + 16384)·32768 + (y + 16384) — малое целое V8 (< 2^30), Set<number> быстрее строк.
// Допустимый мир: |x|, |y| ≤ LIMIT; экземпляры за пределами считаются коллизией.
const OFF = 16384;
const MUL = 32768;
const LIMIT = 16000;
const pack = (x: number, y: number) => (x + OFF) * MUL + (y + OFF);

/** Геометрия комнаты в одном повороте при dx = dy = 0 (кэшируется между прогонами). */
interface ShapeGeo {
  xs: Int32Array;
  ys: Int32Array;
  /** граничные клетки (есть 4-сосед вне комнаты) — только их нужно «раздувать» на gap */
  bxs: Int32Array;
  bys: Int32Array;
  x0: number; y0: number; x1: number; y1: number; // bbox, x1/y1 исключительно
  /** упакованные клетки (лениво, для проверки обзора) */
  set?: Set<number>;
}

/** Геометрия комнаты: кэш по объекту room.cells (проверяется поклеточно — редактор мутирует Set). */
interface Geo {
  keys: CellKey[];
  lx: Int32Array;
  ly: Int32Array;
  boundary: Uint8Array;
  shapes: (ShapeGeo | undefined)[];
  /** внутренняя дальность обзора по cellM */
  sight: Map<number, number>;
}
const geoCache = new WeakMap<Set<CellKey>, Geo>();

function geoOf(cells: Set<CellKey>): Geo {
  const cached = geoCache.get(cells);
  if (cached && cached.keys.length === cells.size) {
    let i = 0;
    let same = true;
    for (const k of cells) if (k !== cached.keys[i++]) { same = false; break; }
    if (same) return cached;
  }
  const n = cells.size;
  const keys: CellKey[] = [];
  const lx = new Int32Array(n);
  const ly = new Int32Array(n);
  const set = new Set<number>();
  let i = 0;
  for (const k of cells) {
    keys.push(k);
    const [x, y] = parseKey(k);
    lx[i] = x; ly[i] = y; i++;
    set.add(pack(x, y));
  }
  const boundary = new Uint8Array(n);
  for (let j = 0; j < n; j++) {
    const x = lx[j], y = ly[j];
    if (!set.has(pack(x + 1, y)) || !set.has(pack(x - 1, y)) || !set.has(pack(x, y + 1)) || !set.has(pack(x, y - 1))) {
      boundary[j] = 1;
    }
  }
  const geo: Geo = { keys, lx, ly, boundary, shapes: [], sight: new Map() };
  geoCache.set(cells, geo);
  return geo;
}

function shapeGeo(geo: Geo, rot: Rot): ShapeGeo {
  const r = rot / 90;
  const cached = geo.shapes[r];
  if (cached) return cached;
  const n = geo.lx.length;
  const xs = new Int32Array(n), ys = new Int32Array(n);
  let nb = 0;
  for (let i = 0; i < n; i++) if (geo.boundary[i]) nb++;
  const bxs = new Int32Array(nb), bys = new Int32Array(nb);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const [x, y] = rotateCell(geo.lx[i], geo.ly[i], rot);
    xs[i] = x; ys[i] = y;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x + 1 > x1) x1 = x + 1;
    if (y + 1 > y1) y1 = y + 1;
    if (geo.boundary[i]) { bxs[b] = x; bys[b] = y; b++; }
  }
  const sg: ShapeGeo = { xs, ys, bxs, bys, x0, y0, x1, y1 };
  geo.shapes[r] = sg;
  return sg;
}

const shapeSet = (sh: ShapeGeo): Set<number> => {
  if (!sh.set) {
    sh.set = new Set<number>();
    for (let i = 0; i < sh.xs.length; i++) sh.set.add(pack(sh.xs[i], sh.ys[i]));
  }
  return sh.set;
};

/** Комната в повороте для текущего прогона: геометрия + повёрнутые метки (метки могли измениться). */
interface Shape {
  g: ShapeGeo;
  conns: Connector[];
}

type Portal = ReturnType<typeof portalOf>;
type Lim = { ortho: number; diag: number };

interface RoomInfo {
  room: Room;
  /** индекс в p.rooms — порядок пула */
  index: number;
  geo: Geo;
  shapes: (Shape | undefined)[];
  /** ростовые метки (см. computeGrowth), по индексу room.connectors */
  grow: boolean[];
  /** собственная (внутренняя) дальность обзора комнаты, м */
  sightM?: number;
  /** оценка числа комнат, которые можно поставить через метку (см. computeGrowth) */
  pot: number[];
  /** «листовая» комната — её можно ставить при дозаполнении (см. computeGrowth) */
  leaf: boolean;
  /** листовая метка: к ней можно пристыковать лист тихой меткой (по индексу room.connectors) */
  leafC: boolean[];
  inPool: boolean;
  weight: number;
  effMin: number;
  effMax: number;
}

interface Placed {
  inst: Instance;
  info: RoomInfo;
  shape: Shape;
  x0: number; y0: number; x1: number; y1: number;
  /** мировые метки (в порядке room.connectors) */
  conns: Connector[];
  linked: boolean[];
  /** причина, по которой метка осталась тупиком (последняя неудачная попытка) */
  why: (StopWhy | undefined)[];
}

type StopWhy = 'nomatch' | 'max' | 'space' | 'sight';

function buildInfo(room: Room, index: number): RoomInfo | null {
  if (room.cells.size === 0) return null;
  const g = room.gen;
  const effMax = room.unique ? 1 : Math.max(0, Math.floor(g.max));
  const effMin = Math.min(Math.max(0, Math.floor(g.min)), effMax);
  const weight = Math.max(0, g.weight);
  return {
    room, index, geo: geoOf(room.cells), shapes: [], grow: [], pot: [], leaf: false, leafC: [],
    inPool: (weight > 0 || effMin > 0) && effMax > 0,
    weight, effMin, effMax,
  };
}

function getShape(info: RoomInfo, rot: Rot): Shape {
  const r = rot / 90;
  let s = info.shapes[r];
  if (!s) {
    s = { g: shapeGeo(info.geo, rot), conns: info.room.connectors.map((c) => transformSeg(c, rot, 0, 0)) };
    info.shapes[r] = s;
  }
  return s;
}

/** Индекс занятости: клетки поставленных экземпляров, раздутые на gap (по Чебышёву); плюс W для обзора. */
class Occupancy {
  /** занятость (1) с раздутием на gap */
  readonly grid = new CellGrid();
  readonly placed: Placed[] = [];
  /** проёмы всех связей (для W) */
  readonly portals: Portal[] = [];
  /** W для инкрементальной проверки обзора: владелец + 2 (0 — стена); ведётся только при пределе */
  readonly w: CellGrid | null;
  /** разрешённые рёбра проёмов при gap = 0 */
  readonly edges = new Set<string>();
  constructor(readonly gap: number, trackSight: boolean) {
    this.w = trackSight ? new CellGrid() : null;
  }

  /** центр масс поставленных клеток: Σx, Σy, Σвес */
  sx = 0;
  sy = 0;
  sw = 0;

  add(p: Placed): void {
    const sg = p.shape.g;
    const n = sg.xs.length;
    this.sx += ((p.x0 + p.x1) / 2) * n;
    this.sy += ((p.y0 + p.y1) / 2) * n;
    this.sw += n;
    const dx = p.inst.dx, dy = p.inst.dy, g = this.gap;
    const grid = this.grid, w = this.w, ow = p.inst.order + 2;
    for (let i = 0; i < sg.xs.length; i++) {
      const x = sg.xs[i] + dx, y = sg.ys[i] + dy;
      grid.set(x, y, 1);
      if (w) w.set(x, y, ow);
    }
    // Раздувать достаточно граничные клетки: любая клетка вне комнаты в пределах gap
    // от комнаты находится в пределах gap и от какой-то граничной клетки.
    if (g > 0) {
      for (let i = 0; i < sg.bxs.length; i++) {
        const bx = sg.bxs[i] + dx, by = sg.bys[i] + dy;
        for (let oy = -g; oy <= g; oy++) for (let ox = -g; ox <= g; ox++) grid.set(bx + ox, by + oy, 1);
      }
    }
    this.placed.push(p);
  }

  addPortal(por: Portal): void {
    this.portals.push(por);
    if (this.w) for (const [x, y] of por.cells) this.w.set(x, y, PORTAL + 2);
    for (const e of por.edges) this.edges.add(e);
  }

  /** Проверка предела обзора для нового проёма (и, если задан, нового экземпляра-кандидата). */
  sightOk(por: Portal, cand: { set: Set<number>; dx: number; dy: number; owner: number } | null, lim: Lim): boolean {
    const w = this.w!;
    const pc = new Set<number>();
    for (const [x, y] of por.cells) pc.add(pack(x, y));
    const own: OwnerFn = (x, y) => {
      const v = w.get(x, y);
      if (v !== 0) return v - 2;
      if (pc.size > 0 && pc.has(pack(x, y))) return PORTAL;
      if (cand && cand.set.has(pack(x - cand.dx, y - cand.dy))) return cand.owner;
      return undefined;
    };
    const base = this.edges;
    const extra = por.edges;
    const edges: EdgeSet = extra.length === 0 ? base : { size: base.size + extra.length, has: (k) => base.has(k) || extra.includes(k) };
    return seedsWithinLimit(own, edges, por.seeds, lim);
  }

  /** Полный скан обзора по W = клетки экземпляров + клетки проёмов. */
  sight(cellM: number): SightResult {
    let n = 0;
    for (const p of this.placed) n += p.shape.g.xs.length;
    for (const por of this.portals) n += por.cells.length;
    const xs = new Int32Array(n), ys = new Int32Array(n), owners = new Int32Array(n);
    let i = 0;
    for (const p of this.placed) {
      const sg = p.shape.g;
      for (let j = 0; j < sg.xs.length; j++, i++) {
        xs[i] = sg.xs[j] + p.inst.dx;
        ys[i] = sg.ys[j] + p.inst.dy;
        owners[i] = p.inst.order;
      }
    }
    for (const por of this.portals) for (const [x, y] of por.cells) { xs[i] = x; ys[i] = y; owners[i] = PORTAL; i++; }
    return scanSight({ xs, ys, owners }, this.edges, cellM);
  }

  /** Перед меткой (сдвинутой на dx, dy) свободна полоса: от gap+1 до depth клеток наружу, вдоль —
   *  клетки метки плюс side клеток с каждой стороны; ни одна клетка полосы не ближе gap к поставленным. */
  frontFree(c: Connector, dx: number, dy: number, depth: number, side: number): boolean {
    const [ox, oy] = SIDE_DELTA[c.side];
    const horiz = c.side === 'N' || c.side === 'S';
    for (let k = this.gap + 1; k <= depth; k++) {
      for (let i = -side; i < c.len + side; i++) {
        const x = c.cx + dx + (horiz ? i : 0) + ox * k;
        const y = c.cy + dy + (horiz ? 0 : i) + oy * k;
        if (this.grid.get(x, y) !== 0) return false;
      }
    }
    return true;
  }

  /** true — кандидат задевает уже поставленные экземпляры ближе, чем через gap клеток стены. */
  collides(shape: Shape, dx: number, dy: number): boolean {
    const sg = shape.g;
    const g = this.gap;
    const wx0 = sg.x0 + dx, wy0 = sg.y0 + dy, wx1 = sg.x1 + dx, wy1 = sg.y1 + dy;
    if (wx0 - g < -LIMIT || wy0 - g < -LIMIT || wx1 + g > LIMIT || wy1 + g > LIMIT) return true;
    // 1) пересечение bbox (расширенных на gap)
    let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
    for (const p of this.placed) {
      if (p.x0 - g < wx1 && wx0 < p.x1 + g && p.y0 - g < wy1 && wy0 < p.y1 + g) {
        if (p.x0 - g < ux0) ux0 = p.x0 - g;
        if (p.y0 - g < uy0) uy0 = p.y0 - g;
        if (p.x1 + g > ux1) ux1 = p.x1 + g;
        if (p.y1 + g > uy1) uy1 = p.y1 + g;
      }
    }
    if (ux0 === Infinity) return false;
    // 2) поклеточно — только клетки внутри объединения задетых bbox
    const grid = this.grid;
    const xs = sg.xs, ys = sg.ys;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] + dx, y = ys[i] + dy;
      if (x < ux0 || x >= ux1 || y < uy0 || y >= uy1) continue;
      if (grid.get(x, y) !== 0) return true;
    }
    return false;
  }
}

const now = (): number => (globalThis.performance ? globalThis.performance.now() : Date.now());

function sanitize(p: Project, overrides?: Partial<GeneratorSettings>): GeneratorSettings {
  const s = { ...p.generator, ...(overrides ?? {}) };
  return {
    seed: String(s.seed ?? ''),
    count: Math.max(1, Math.floor(Number(s.count) || 1)),
    gap: Math.min(64, Math.max(0, Math.floor(Number(s.gap) || 0))),
    match: s.match === 'tag' || s.match === 'len' ? s.match : 'exact',
    startRoomId: s.startRoomId ?? null,
    passId: s.passId ?? null,
    sightM: Math.max(0, Number(s.sightM) || 0),
    fill: s.fill === true,
  };
}

/** Взвешенный выбор; если сумма весов ≤ 0 — первый элемент (без обращения к ГСЧ). */
function pickWeighted(rng: Rng, weights: number[]): number {
  if (weights.length === 0) return -1;
  const i = rng.weightedIndex(weights);
  return i < 0 ? 0 : i;
}

/** Сколько попыток раскладки делать, если count не достигнут. */
const ATTEMPTS = 6;
/** Адаптивный резерв роста: K = clamp(RESERVE + floor(осталось / RESERVE_STEP), RESERVE, RESERVE_MAX). */
const RESERVE_STEP = 15;
const RESERVE_MAX = 10;
/** «Свободный фасад» ростовой метки в ростовом проходе: глубина и запас по бокам, м. */
const FRONT_DEPTH_M = 2;
const FRONT_SIDE_M = 0.5;
/** Порог «резерва роста»: при ≤ стольких открытых ростовых метках они защищаются от листьев. */
const RESERVE = 2;
/** Резерв включается, если листовой фронт не добирает count: Σ pot · SUPPLY_FACTOR < count − поставлено. */
const SUPPLY_FACTOR = 0.5;
/** Бонус приоритета ростовой метки: её ключ = depth − GROW_BONUS. */
const GROW_BONUS = 1;
/** При fill: бонус приоритета листовой метки (к ней можно пристыковать лист) — квартиры достраиваются раньше. */
const LEAF_BONUS = 1;
/** Глубина и потолок оценки потенциала метки. */
const POT_DEPTH = 6;
const POT_CAP = 1000;

/** Внутренняя дальность обзора комнаты (не зависит от поворота). */
function roomSightM(info: RoomInfo, cellM: number): number {
  const geo = info.geo;
  let m = geo.sight.get(cellM);
  if (m === undefined) {
    m = scanSight({ xs: geo.lx, ys: geo.ly, owners: new Int32Array(geo.lx.length) }, new Set<string>(), cellM).maxM;
    geo.sight.set(cellM, m);
  }
  return m;
}

/** При пределе обзора исключить из пула комнаты, внутри которых обзор уже длиннее. */
function applySightLimit(infos: (RoomInfo | null)[], sightM: number, cellM: number): { info: RoomInfo; m: number }[] {
  const out: { info: RoomInfo; m: number }[] = [];
  if (!(sightM > 0)) return out;
  for (const info of infos) {
    if (!info) continue;
    info.sightM = roomSightM(info, cellM);
    if (info.sightM > sightM + 1e-9 && info.inPool) {
      info.inPool = false;
      out.push({ info, m: info.sightM });
    }
  }
  return out;
}

/**
 * Ростовые метки (наибольшая неподвижная точка): метка c ростовая, если в пуле есть комната S с
 * совместимой меткой b, у которой есть другая ростовая метка b' ≠ b. Изначально ростовые все метки
 * (len ≥ 1), затем снимаем флаг, пока что-то меняется. Метки, ведущие только к «листьям»
 * (кухня, санузел, квартира целиком), получают false; лестницы и коридоры — true.
 * Заодно считает pot — оптимистичную оценку числа комнат через метку (§4.2 GENERATOR.md).
 */
function computeGrowth(infos: (RoomInfo | null)[], pool: RoomInfo[], match: GeneratorSettings['match']): void {
  const all = infos.filter((x): x is RoomInfo => !!x);
  for (const info of all) info.grow = info.room.connectors.map((c) => c.len >= 1);
  // совместимые пары (S, b) для каждой метки — считаются один раз
  const compat = new Map<RoomInfo, [RoomInfo, number][][]>();
  for (const info of all) {
    compat.set(info, info.room.connectors.map((c) => {
      const out: [RoomInfo, number][] = [];
      if (c.len < 1) return out;
      for (const s of pool) s.room.connectors.forEach((b, bi) => { if (b.len >= 1 && compatible(c, b, match)) out.push([s, bi]); });
      return out;
    }));
  }
  // оценка «сколько комнат можно поставить через метку» (оптимистично, без геометрии и max):
  // E_k(c) = max по совместимым (S, b) из 1 + Σ_{b' ≠ b} E_{k−1}(S, b'), с потолком POT_CAP
  for (const info of all) info.pot = info.room.connectors.map(() => 0);
  for (let k = 0; k < POT_DEPTH; k++) {
    const next = new Map<RoomInfo, number[]>();
    for (const info of all) {
      next.set(info, compat.get(info)!.map((list) => {
        let best = 0;
        for (const [s, bi] of list) {
          let v = 1;
          s.pot.forEach((x, j) => { if (j !== bi) v += x; });
          if (v > best) best = v;
        }
        return Math.min(POT_CAP, best);
      }));
    }
    for (const info of all) info.pot = next.get(info)!;
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const info of all) {
      const list = compat.get(info)!;
      info.grow.forEach((g, ci) => {
        if (!g) return;
        const ok = list[ci].some(([s, bi]) => s.grow.some((x, j) => x && j !== bi));
        if (!ok) { info.grow[ci] = false; changed = true; }
      });
    }
  }
  // листовые комнаты: есть метка b, пристыкованная которой комната не получает ростовых меток,
  // и комната не «вход» в хаб (нет меток, совместимых с метками хабов); с одной меткой — лист всегда.
  // Хаб — комната с ≥ 2 ростовыми метками. При дозаполнении листья ставятся только такими b.
  const hubs = all.filter((i) => i.grow.filter(Boolean).length >= 2);
  for (const info of all) {
    const conns = info.room.connectors.filter((c) => c.len >= 1);
    if (conns.length === 0) { info.leaf = false; continue; }
    if (conns.length === 1) { info.leaf = true; continue; }
    const quiet = info.room.connectors.some((c, bi) => c.len >= 1 && growOthers(info, bi) === 0);
    const entrance = conns.some((c) => hubs.some((h) => h !== info && h.room.connectors.some((hc) => hc.len >= 1 && compatible(c, hc, match))));
    info.leaf = quiet && !entrance;
  }
  const leaves = pool.filter((i) => i.leaf);
  for (const info of all) {
    info.leafC = info.room.connectors.map((c) => c.len >= 1 && leaves.some((s) =>
      s.room.connectors.some((b, bi) => b.len >= 1 && compatible(c, b, match) && growOthers(s, bi) === 0)));
  }
}

/** Анализ роста для UI и тестов: по каждой комнате — ростовые метки и оценка потенциала (по индексу connectors). */
export function analyzeGrowth(p: Project, overrides?: Partial<GeneratorSettings>): Record<string, { grow: boolean[]; pot: number[]; leaf: boolean }> {
  const settings = sanitize(p, overrides);
  const infos = p.rooms.map((r, i) => buildInfo(r, i));
  applySightLimit(infos, settings.sightM, p.settings.cellM > 0 ? p.settings.cellM : 0.1);
  const pool = infos.filter((x): x is RoomInfo => !!x && x.inPool);
  computeGrowth(infos, pool, settings.match);
  const out: Record<string, { grow: boolean[]; pot: number[]; leaf: boolean }> = {};
  for (const info of infos) if (info) out[info.room.id] = { grow: info.grow.slice(), pot: info.pot.slice(), leaf: info.leaf };
  return out;
}

/** Число других ростовых меток комнаты, если она пристыкована меткой bi. */
const growOthers = (info: RoomInfo, bi: number): number => {
  let n = 0;
  info.grow.forEach((g, j) => { if (g && j !== bi) n++; });
  return n;
};

/** Поставить экземпляр в раскладку. */
function placeInstance(lay: Layout, info: RoomInfo, rot: Rot, dx: number, dy: number, parent: Placed | null): Placed {
  const shape = getShape(info, rot);
  const n = lay.instances.length;
  const inst: Instance = {
    id: `i${n}`, roomId: info.room.id, rot, dx, dy, order: n,
    parent: parent ? parent.inst.id : null,
    depth: parent ? parent.inst.depth + 1 : 0,
  };
  const pl: Placed = {
    inst, info, shape,
    x0: shape.g.x0 + dx, y0: shape.g.y0 + dy, x1: shape.g.x1 + dx, y1: shape.g.y1 + dy,
    conns: shape.conns.map((c) => ({ ...c, cx: c.cx + dx, cy: c.cy + dy })),
    linked: info.room.connectors.map(() => false),
    why: info.room.connectors.map(() => undefined),
  };
  lay.instances.push(inst);
  lay.occ.add(pl);
  lay.counts.set(info, (lay.counts.get(info) ?? 0) + 1);
  return pl;
}

/** Замыкание петель (§4.6): несвязанные метки лицом к лицу связываются по порядку. */
function closeLoops(lay: Layout, match: GeneratorSettings['match'], gap: number, lim: Lim | null): void {
  const occ = lay.occ;
  const free: { pl: Placed; ci: number }[] = [];
  for (const pl of occ.placed) pl.conns.forEach((c, ci) => { if (!pl.linked[ci] && c.len >= 1) free.push({ pl, ci }); });
  for (let i = 0; i < free.length; i++) {
    const a = free[i];
    if (a.pl.linked[a.ci]) continue;
    const A = a.pl.conns[a.ci];
    for (let j = i + 1; j < free.length; j++) {
      const b = free[j];
      if (b.pl === a.pl || b.pl.linked[b.ci]) continue;
      const B = b.pl.conns[b.ci];
      if (!compatible(A, B, match) || !facing(A, B, gap)) continue;
      const por = portalOf(A, B, gap);
      if (lim && !occ.sightOk(por, null, lim)) continue; // петля открыла бы слишком длинный обзор
      occ.addPortal(por);
      a.pl.linked[a.ci] = true;
      b.pl.linked[b.ci] = true;
      lay.links.push({ a: { inst: a.pl.inst.id, connector: A.id }, b: { inst: b.pl.inst.id, connector: B.id } });
      break;
    }
  }
}

/**
 * Дозаполнение (§4.7 GENERATOR.md): открытые метки по очереди (order экземпляра, индекс метки; новые — в конец)
 * закрываются только листовыми комнатами. Возвращает число добавленных экземпляров.
 */
function fillPass(lay: Layout, settings: GeneratorSettings, pool: RoomInfo[], lim: Lim | null, F: Rng): number {
  const gap = settings.gap;
  const occ = lay.occ;
  const before = lay.instances.length;
  const queue: { pl: Placed; ci: number }[] = [];
  const push = (pl: Placed) => pl.conns.forEach((c, ci) => { if (!pl.linked[ci] && c.len >= 1) queue.push({ pl, ci }); });
  for (const pl of occ.placed) push(pl);
  const cnt = (i: RoomInfo) => lay.counts.get(i) ?? 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const { pl: parent, ci: aIdx } = queue[qi];
    if (parent.linked[aIdx]) continue;
    const A = parent.conns[aIdx];
    // лист ставится только меткой, после которой у него не остаётся ростовых меток
    const okB = (info: RoomInfo, b: Connector, bi: number) =>
      b.len >= 1 && compatible(A, b, settings.match) && growOthers(info, bi) === 0;
    const g1: RoomInfo[] = [];
    const g2: RoomInfo[] = [];
    for (const info of pool) {
      if (!info.leaf) continue;
      const c = cnt(info);
      if (c >= info.effMax) continue;
      if (!info.room.connectors.some((b, bi) => okB(info, b, bi))) continue;
      if (c < info.effMin) g1.push(info);
      else if (info.weight > 0) g2.push(info);
    }
    let done = false;
    let sightFails = 0;
    for (const group of [g1, g2]) {
      const rest = group.slice();
      while (!done && rest.length > 0) {
        const info = rest.splice(pickWeighted(F, rest.map((x) => x.weight)), 1)[0];
        const bIdx: number[] = [];
        info.room.connectors.forEach((b, i) => { if (okB(info, b, i)) bIdx.push(i); });
        F.shuffle(bIdx);
        for (const bi of bIdx) {
          const rot = rotFor(info.room.connectors[bi].side, OPPOSITE[A.side]);
          const shape = getShape(info, rot);
          const Bw = shape.conns[bi];
          const t = dockTarget(A, Bw.len, gap);
          const dx = t.cx - Bw.cx, dy = t.cy - Bw.cy;
          if (occ.collides(shape, dx, dy)) continue;
          const por = portalOf(A, { ...Bw, cx: Bw.cx + dx, cy: Bw.cy + dy }, gap);
          if (lim && !occ.sightOk(por, { set: shapeSet(shape.g), dx, dy, owner: lay.instances.length }, lim)) { sightFails++; continue; }
          const child = placeInstance(lay, info, rot, dx, dy, parent);
          occ.addPortal(por);
          parent.linked[aIdx] = true;
          child.linked[bi] = true;
          lay.links.push({ a: { inst: parent.inst.id, connector: A.id }, b: { inst: child.inst.id, connector: Bw.id } });
          push(child);
          done = true;
          break;
        }
      }
      if (done) break;
    }
    // причина из основного роста важнее: там пробовались все комнаты, а здесь только листья
    if (!done && parent.why[aIdx] === undefined) {
      parent.why[aIdx] = failWhy(lay, pool, A, settings.match, g1.length + g2.length > 0, sightFails, (i) => i.leaf);
    }
  }
  closeLoops(lay, settings.match, gap, lim);
  return lay.instances.length - before;
}

interface Layout {
  placed: Placed[];
  instances: Instance[];
  links: Link[];
  counts: Map<RoomInfo, number>;
  start: RoomInfo | null;
  occ: Occupancy;
  /** комнаты, упёршиеся в max на тупиковых метках */
  maxBlocked: Set<RoomInfo>;
}

/** Причина неудачи метки A: нет кандидатов вовсе / все упёрлись в max / коллизии / предел обзора. */
function failWhy(lay: Layout, pool: RoomInfo[], A: Connector, match: GeneratorSettings['match'], hadCand: boolean, sightFails: number,
  filter: (info: RoomInfo) => boolean): StopWhy {
  if (hadCand) return sightFails > 0 ? 'sight' : 'space';
  const blocked = pool.filter((info) => filter(info) && (lay.counts.get(info) ?? 0) >= info.effMax &&
    info.room.connectors.some((b) => b.len >= 1 && compatible(A, b, match)));
  for (const b of blocked) lay.maxBlocked.add(b);
  return blocked.length ? 'max' : 'nomatch';
}

/** Одна попытка раскладки на потоке L (§4 GENERATOR.md). */
function layoutAttempt(
  settings: GeneratorSettings, pool: RoomInfo[], tagged: RoomInfo[], fixedStart: RoomInfo | null, L: Rng, lim: Lim | null,
  cellM: number,
): Layout {
  const gap = settings.gap;
  const counts = new Map<RoomInfo, number>();
  const cnt = (i: RoomInfo) => counts.get(i) ?? 0;
  const instances: Instance[] = [];
  const links: Link[] = [];
  const occ = new Occupancy(gap, !!lim);

  let start = fixedStart;
  if (!start) {
    if (tagged.length) start = tagged[pickWeighted(L, tagged.map((x) => x.weight))];
    else if (pool.length) start = pool[pickWeighted(L, pool.map((x) => x.weight))];
  }
  const out: Layout = { placed: occ.placed, instances, links, counts, start, occ, maxBlocked: new Set() };
  if (!start) return out;

  const place = (info: RoomInfo, rot: Rot, dx: number, dy: number, parent: Placed | null): Placed =>
    placeInstance(out, info, rot, dx, dy, parent);
  const frontDepth = Math.max(gap + 1, Math.round(FRONT_DEPTH_M / cellM));
  const frontSide = Math.round(FRONT_SIDE_M / cellM);

  place(start, 0, 0, 0, null);

  // ── Рост ──
  interface Open { pl: Placed; ci: number; grow: boolean }
  const open: Open[] = [];
  const pushOpen = (pl: Placed, skip: number) => {
    pl.info.room.connectors.forEach((c, ci) => {
      if (ci !== skip && c.len >= 1) open.push({ pl, ci, grow: pl.info.grow[ci] });
    });
  };
  pushOpen(occ.placed[0], -1);
  // при fill листовые метки обрабатываются раньше — квартира достраивается, пока есть место
  const leafBonus = settings.fill ? LEAF_BONUS : 0;
  const keyOf = (o: Open) => o.pl.inst.depth - (o.grow ? GROW_BONUS : 0) - (o.pl.info.leafC[o.ci] ? leafBonus : 0);

  while (instances.length < settings.count && open.length > 0) {
    // резерв роста: если ростовых меток мало — обрабатываем только их
    let gOpen = 0;
    for (const o of open) if (o.grow) gOpen++;
    // адаптивный резерв: чем больше осталось поставить, тем больше ростовых меток держим открытыми
    const K = Math.min(RESERVE_MAX, Math.max(RESERVE, RESERVE + Math.floor((settings.count - instances.length) / RESERVE_STEP)));
    const few = gOpen > 0 && gOpen <= K;
    // …и листовой фронт (оценка по pot) не добирает count — тогда ростовые метки идут первыми
    let supply = 0;
    for (const o of open) if (!o.grow) supply += o.pl.info.pot[o.ci];
    const reserve = few && supply * SUPPLY_FACTOR < settings.count - instances.length;
    // выбор метки: случайная среди меток с минимальным ключом depth − (ростовая ? GROW_BONUS : 0)
    let oi: number;
    if (reserve) {
      // рост наружу: ростовая метка, самая далёкая от центра масс поставленного (без ГСЧ)
      oi = -1;
      let bestD = -1;
      const cx = occ.sx / occ.sw, cy = occ.sy / occ.sw;
      open.forEach((o, i) => {
        if (!o.grow) return;
        const [mx, my] = segmentMid(o.pl.conns[o.ci]);
        const d = (mx - cx) * (mx - cx) + (my - cy) * (my - cy);
        if (d > bestD + 1e-9) { bestD = d; oi = i; }
      });
    } else {
      let minKey = Infinity;
      for (const o of open) if (keyOf(o) < minKey) minKey = keyOf(o);
      const cand: number[] = [];
      open.forEach((o, i) => { if (keyOf(o) === minKey) cand.push(i); });
      oi = cand[L.int(0, cand.length - 1)];
    }
    const { pl: parent, ci: aIdx } = open[oi];
    open.splice(oi, 1);
    const A = parent.conns[aIdx];

    // кандидаты: сначала комнаты, не набравшие min; затем остальные с весом > 0
    const g1: RoomInfo[] = [];
    const g2: RoomInfo[] = [];
    for (const info of pool) {
      const c = cnt(info);
      if (c >= info.effMax) continue;
      if (!info.room.connectors.some((b) => b.len >= 1 && compatible(A, b, settings.match))) continue;
      if (c < info.effMin) g1.push(info);
      else if (info.weight > 0) g2.push(info);
    }

    // в резерве сначала проход только по парам (комната, метка), дающим рост; затем обычный
    // защита: одна из последних ростовых меток — сначала проход только по комнатам, дающим рост
    const passes: boolean[] = few && parent.info.grow[aIdx] ? [true, false] : [false];
    let done = false;
    let sightFails = 0;
    for (const growOnly of passes) {
      const okB = (info: RoomInfo, b: Connector, bi: number) =>
        b.len >= 1 && compatible(A, b, settings.match) && (!growOnly || growOthers(info, bi) > 0);
      for (const group of [g1, g2]) {
        const rest = growOnly ? group.filter((info) => info.room.connectors.some((b, bi) => okB(info, b, bi))) : group.slice();
        while (!done && rest.length > 0) {
          const info = rest.splice(pickWeighted(L, rest.map((x) => x.weight)), 1)[0];
          const bIdx: number[] = [];
          info.room.connectors.forEach((b, i) => { if (okB(info, b, i)) bIdx.push(i); });
          L.shuffle(bIdx);
          for (const bi of bIdx) {
            const rot = rotFor(info.room.connectors[bi].side, OPPOSITE[A.side]);
            const shape = getShape(info, rot);
            const Bw = shape.conns[bi];
            const t = dockTarget(A, Bw.len, gap);
            const dx = t.cx - Bw.cx, dy = t.cy - Bw.cy;
            if (occ.collides(shape, dx, dy)) continue;
            // в ростовом проходе у новой комнаты должна остаться хотя бы одна ростовая метка со свободным
            // «фасадом» — полосой глубиной FRONT_DEPTH_M и шириной метки + FRONT_SIDE_M с каждой стороны
            if (growOnly && !shape.conns.some((c, j) => j !== bi && info.grow[j] && occ.frontFree(c, dx, dy, frontDepth, frontSide))) continue;
            // предел обзора: новые линии проходят только через проём новой связи
            const por = portalOf(A, { ...Bw, cx: Bw.cx + dx, cy: Bw.cy + dy }, gap);
            if (lim && !occ.sightOk(por, { set: shapeSet(shape.g), dx, dy, owner: instances.length }, lim)) { sightFails++; continue; }
            const child = place(info, rot, dx, dy, parent);
            occ.addPortal(por);
            parent.linked[aIdx] = true;
            child.linked[bi] = true;
            links.push({ a: { inst: parent.inst.id, connector: A.id }, b: { inst: child.inst.id, connector: Bw.id } });
            pushOpen(child, bi);
            done = true;
            break;
          }
        }
        if (done) break;
      }
      if (done) break;
    }
    // не подошло ничего — метка остаётся тупиком (linked = false), запоминаем причину
    if (!done) parent.why[aIdx] = failWhy(out, pool, A, settings.match, g1.length + g2.length > 0, sightFails, () => true);
  }

  // ── Замыкание петель ──
  closeLoops(out, settings.match, gap, lim);
  return out;
}

/** Сводка причин по тупиковым меткам выбранной раскладки. */
function stopReport(lay: Layout, settings: GeneratorSettings, withSight: boolean): RunStop {
  const st: RunStop = { open: 0, noMatch: 0, atMax: 0, noSpace: 0, sight: 0, maxRooms: [], noMatchTags: [] };
  const tags = new Set<string>();
  for (const pl of lay.placed) {
    pl.conns.forEach((c, ci) => {
      if (pl.linked[ci] || c.len < 1) return;
      st.open++;
      const why = pl.why[ci] ?? 'space';
      if (why === 'nomatch') { st.noMatch++; tags.add(c.tag); }
      else if (why === 'max') st.atMax++;
      else if (why === 'sight' && withSight) st.sight++;
      else st.noSpace++;
    });
  }
  st.maxRooms = [...lay.maxBlocked].sort((a, b) => a.index - b.index).map((i) => i.room.id);
  st.noMatchTags = [...tags].sort();
  return st;
}

/** Понятные строки «почему рост остановился» и советы. */
function stopWarnings(st: RunStop, placed: number, settings: GeneratorSettings, p: Project): string[] {
  const out: string[] = [];
  const parts: string[] = [];
  if (st.noSpace) parts.push(`нет места — ${st.noSpace}`);
  if (st.atMax) parts.push(`все подходящие комнаты упёрлись в max — ${st.atMax}`);
  if (st.sight) parts.push(`предел обзора — ${st.sight}`);
  if (st.noMatch) parts.push(`нет совместимых комнат — ${st.noMatch}`);
  out.push(`Поставлено ${placed} из ${settings.count} комнат: рост остановился, открытых меток ${st.open} (${parts.join(', ') || 'нет'}).`);
  const name = (id: string) => `«${p.rooms.find((r) => r.id === id)?.name ?? id}»`;
  if (st.maxRooms.length) out.push(`Совет: поднимите max у: ${st.maxRooms.slice(0, 12).map(name).join(', ')}${st.maxRooms.length > 12 ? ' и др.' : ''}.`);
  if (st.sight && st.sight * 4 >= st.open) out.push(`Совет: увеличьте предел обзора (сейчас ${settings.sightM} м) — он отверг много стыковок.`);
  if (st.noSpace * 2 >= st.open) out.push('Совет: мало места — добавьте хабы (лестницы, коридоры с несколькими ростовыми метками), ведущие наружу, или уменьшите count.');
  if (st.noMatchTags.length) out.push(`Совет: для меток ${st.noMatchTags.map((t) => `«${t}»`).join(', ')} нет совместимых комнат в пуле — добавьте комнаты с ответными метками или уберите лишние.`);
  return out;
}

/** Сгенерировать прогон. Детерминирован по (проект, settings.seed). Не мутирует проект. */
export function generateRun(p: Project, overrides?: Partial<GeneratorSettings>): Run {
  const t0 = now();
  const settings = sanitize(p, overrides);
  const root = makeRng(settings.seed);
  const warnings: string[] = [];

  // ── 1. Пул ──
  const infos: (RoomInfo | null)[] = p.rooms.map((r, i) => buildInfo(r, i));
  const cellM = p.settings.cellM > 0 ? p.settings.cellM : 0.1;
  const lim = settings.sightM > 0 ? sightLimits(settings.sightM, cellM) : null;
  const tooLong = applySightLimit(infos, settings.sightM, cellM);
  if (tooLong.length) {
    const names = tooLong.map((t) => `«${t.info.room.name}» (${t.m} м)`).join(', ');
    warnings.push(`Предел обзора ${settings.sightM} м: исключены комнаты, внутри которых обзор длиннее — ${names}.`);
  }
  const pool = infos.filter((x): x is RoomInfo => !!x && x.inPool);
  for (const r of p.rooms) {
    if (r.gen.min > 0 && r.cells.size === 0) warnings.push(`Комната «${r.name}» пуста (нет клеток) — пропущена, хотя min = ${r.gen.min}.`);
    const eMax = r.unique ? 1 : r.gen.max;
    if (r.cells.size > 0 && r.gen.min > Math.max(0, eMax)) {
      warnings.push(`Комната «${r.name}»: min = ${r.gen.min} больше max = ${Math.max(0, eMax)}${r.unique ? ' (уникальная)' : ''} — min урезан.`);
    }
  }
  computeGrowth(infos, pool, settings.match);

  // ── 2. Старт (фиксированный — без ГСЧ) ──
  let fixedStart: RoomInfo | null = null;
  if (settings.startRoomId) {
    const i = p.rooms.findIndex((r) => r.id === settings.startRoomId);
    if (i < 0) warnings.push(`Стартовая комната (id ${settings.startRoomId}) не найдена — выбрана автоматически.`);
    else if (!infos[i]) warnings.push(`Стартовая комната «${p.rooms[i].name}» пуста — выбрана автоматически.`);
    else fixedStart = infos[i];
  }
  const tagged = infos.filter((x): x is RoomInfo => !!x && x.room.tags.includes('start'));

  // ── 3–4. Раскладка с перезапусками ──
  let best: Layout | null = null;
  let bestK = 0;
  for (let k = 0; k < ATTEMPTS; k++) {
    const lay = layoutAttempt(settings, pool, tagged, fixedStart, root.sub(k === 0 ? 'layout' : `layout:${k}`), lim, cellM);
    if (!best || lay.instances.length > best.instances.length) { best = lay; bestK = k; }
    if (!lay.start || lay.instances.length >= settings.count) break;
  }
  // ── Дозаполнение листьями ──
  const filled = settings.fill && best!.start ? fillPass(best!, settings, pool, lim, root.sub('fill')) : 0;
  if (settings.fill && best!.start) warnings.push(`Дозаполнение: +${filled} комнат (итого ${best!.instances.length}).`);
  const { placed, instances, links, counts, start, occ } = best!;
  if (start && lim) {
    const sm = start.sightM ?? roomSightM(start, cellM);
    if (sm > settings.sightM + 1e-9) {
      warnings.push(`Стартовая комната «${start.room.name}» сама длиннее предела обзора (${sm} м > ${settings.sightM} м) — поставлена всё равно.`);
    }
  }
  const sight = occ.sight(cellM);
  const cnt = (i: RoomInfo) => counts.get(i) ?? 0;
  if (bestK > 0) warnings.push(`Раскладка: взята попытка ${bestK + 1} из ${ATTEMPTS} (предыдущие заглохли раньше count).`);

  const openConnectors: Run['openConnectors'] = [];
  for (const pl of placed) {
    pl.conns.forEach((c, ci) => { if (!pl.linked[ci] && c.len >= 1) openConnectors.push({ inst: pl.inst.id, connector: c.id }); });
  }

  // ── 5. Предупреждения ──
  if (!start) warnings.push('Нет ни одной комнаты для генерации (нужны клетки и вес > 0 или min > 0).');
  let stop: RunStop | undefined;
  if (start && instances.length < settings.count) {
    stop = stopReport(best!, settings, lim !== null);
    warnings.push(...stopWarnings(stop, instances.length, settings, p));
  }
  for (const info of pool) {
    const c = cnt(info);
    if (c < info.effMin) warnings.push(`Комната «${info.room.name}»: поставлено ${c} из минимума ${info.effMin}.`);
  }

  // ── Наполнение ──
  const pass = settings.passId ? p.economy.passes.find((x) => x.id === settings.passId) ?? null : null;
  if (settings.passId && !pass) warnings.push(`Проходка (id ${settings.passId}) не найдена — розыгрыш без неё.`);
  const content: InstanceContent[] = [];
  const accById = new Map<string, number>();
  for (const pl of placed) {
    // отделка — на своём потоке: правила отделки не сдвигают остальное наполнение
    const c = rollContent(p, pl.info.room, pl.inst, root.sub(`content:${pl.inst.id}`), pass, root.sub(`finish:${pl.inst.id}`));
    c.dangerAcc = (pl.inst.parent ? accById.get(pl.inst.parent) ?? 0 : 0) + c.danger;
    accById.set(pl.inst.id, c.dangerAcc);
    content.push(c);
  }
  // подмены вариантов спотов ради проходимости (§5.2) — строка только если они были
  const walkW = walkWarning(content);
  if (walkW) warnings.push(walkW);

  const totals: Record<string, number> = {};
  for (const c of content) {
    for (const l of c.loot) totals[l.itemId] = (totals[l.itemId] ?? 0) + l.count;
    for (const s of c.spots) if (s.content && s.content.kind === 'item') totals[s.content.id] = (totals[s.content.id] ?? 0) + 1;
  }

  return {
    seed: settings.seed,
    settings,
    instances,
    links,
    openConnectors,
    content,
    totals,
    warnings,
    sight,
    ...(stop ? { stop } : {}),
    ms: Math.round((now() - t0) * 100) / 100,
  };
}

const boostOf = (pass: Pass | null, itemId: string): number => {
  const m = pass?.itemBoost?.[itemId];
  return typeof m === 'number' && m >= 0 ? m : 1;
};

/**
 * Розыгрыш наполнения одного экземпляра. Порядок обращений к rng фиксирован (см. GENERATOR.md):
 * тир → группы спотов → лут комнаты → лут тира. dangerAcc заполняет вызывающий.
 * Вариант группы, перегораживающий проход между дверями, подменяется без бросков (WalkRoll, walk.ts),
 * поэтому поток rng от проходимости не зависит; подмена отмечена groups[i].fallback = true.
 * Отделка разыгрывается на отдельном потоке finishRng (в прогоне — root.sub("finish:" + inst.id));
 * без него — на rng.sub("finish"), не сдвигая rng.
 */
export function rollContent(p: Project, room: Room, inst: Instance, rng: Rng, pass: Pass | null, finishRng?: Rng): InstanceContent {
  const finish = rollFinish(p, room, finishRng ?? rng.sub('finish'));

  // 1. Элитность
  let tier: Tier | null = null;
  if (room.elite.length > 0) {
    const tiers = room.elite.map((e) => p.economy.tiers.find((t) => t.id === e.tierId) ?? null);
    const w = room.elite.map((e, i) => {
      const t = tiers[i];
      if (!t) return 0;
      return Math.max(0, e.weight) * (pass && t.level >= 2 ? pass.tierBoost : 1);
    });
    const i = rng.weightedIndex(w);
    tier = i >= 0 ? tiers[i] : null;
  }

  // 2. Группы спотов (+ проходимость §5.2: подбор варианта без обращений к ГСЧ)
  const groups: InstanceContent['groups'] = [];
  const spots: SpawnedSpot[] = [];
  const walk = new WalkRoll(p, room);
  for (const g of room.spotGroups) {
    if (g.variants.length === 0) continue;
    const vi = rng.weightedIndex(g.variants.map((v) => v.weight));
    if (vi < 0) continue; // все веса 0 — группа не разыгрывается
    const { v, fallback, strip } = walk.choose(g, vi);
    const entry: ContentGroup = fallback ? { groupId: g.id, variantId: v.id, fallback: true } : { groupId: g.id, variantId: v.id };
    groups.push(entry);
    for (const s of room.spots) {
      if (s.groupId !== g.id) continue;
      const [rx, ry] = rotatePoint(s.x, s.y, inst.rot);
      let a: Assign | undefined = v.assign[s.id];
      if (a && strip && walk.blocks(a)) a = undefined; // крайний случай: без напольных prop
      spots.push({
        spotId: s.id,
        x: rx + inst.dx,
        y: ry + inst.dy,
        rot: normDeg(s.rot + inst.rot + (a ? a.rot : 0)),
        groupId: g.id,
        variantId: v.id,
        content: a ? { kind: a.kind, id: a.id, rot: a.rot } : null,
      });
    }
  }

  // 3. Лут комнаты
  const loot: SpawnedLoot[] = [];
  for (const row of room.loot) {
    const pr = Math.min(1, row.chance * boostOf(pass, row.itemId));
    if (!rng.chance(pr)) continue;
    const count = rng.int(Math.floor(row.min), Math.floor(row.max));
    if (count > 0) loot.push({ itemId: row.itemId, count, from: 'room', rowId: row.id });
  }

  // 4. Лут тира
  if (tier) {
    const propTags = new Map(p.props.map((x) => [x.id, x.tags] as const));
    for (const row of tier.loot) {
      const places: string[] = [];
      if (row.where) {
        for (const d of room.decor) if (propTags.get(d.propId)?.includes(row.where)) places.push(d.id);
        for (const s of spots) {
          if (s.content?.kind === 'prop' && propTags.get(s.content.id)?.includes(row.where)) places.push(`spot:${s.spotId}`);
        }
        if (places.length === 0) continue;
      }
      let itemId: string;
      let shopId: string | undefined;
      if (row.source.kind === 'shop') {
        const shop = p.economy.shops.find((s) => s.id === row.source.id);
        if (!shop || shop.offers.length === 0) continue;
        itemId = rng.pick(shop.offers).itemId;
        shopId = shop.id;
      } else {
        itemId = row.source.id;
      }
      const steps = sortedSteps(row.steps);
      const boost = boostOf(pass, itemId);
      let count = 0;
      for (const st of steps) {
        if (rng.chance(Math.min(1, st.chance * boost))) { count = rng.int(1, st.upTo); break; }
      }
      if (count <= 0) continue;
      const out: SpawnedLoot = { itemId, count, from: 'tier', rowId: row.id };
      if (row.where) out.decorId = rng.pick(places);
      if (shopId) out.shopId = shopId;
      loot.push(out);
    }
  }

  return {
    inst: inst.id,
    tierId: tier ? tier.id : null,
    danger: tier ? tier.danger : 0,
    dangerAcc: tier ? tier.danger : 0,
    groups,
    spots,
    loot,
    finish,
  };
}

/**
 * Отделка экземпляра (§5.6 GENERATOR.md): сначала стены, потом пол, на одном потоке F.
 * Явное назначение комнаты (существующая отделка своей поверхности) — без броска; иначе правило
 * по первому тегу комнаты, у которого оно есть: F.weightedIndex(веса строк), −1 (Σ ≤ 0) — без броска, null.
 */
export function rollFinish(p: Project, room: Room, F: Rng): { wall: string | null; floor: string | null } {
  const rule = finishRuleFor(p, room);
  const one = (s: FinishSurface): string | null => {
    const own = room.finish?.[s];
    if (own && (p.finishes ?? []).some((f) => f.id === own && f.surface === s)) return own;
    const rows = finishRuleWeights(p, rule, s);
    const i = F.weightedIndex(rows.map((x) => x.w));
    return i >= 0 ? rows[i].finishId : null;
  };
  const wall = one('wall');
  const floor = one('floor');
  return { wall, floor };
}

/** Ступени в порядке проверки: upTo по убыванию (устойчиво), ступени с upTo < 1 отбрасываются. */
export function sortedSteps<T extends { upTo: number }>(steps: readonly T[]): T[] {
  return steps.filter((s) => Math.floor(s.upTo) >= 1).map((s) => ({ ...s, upTo: Math.floor(s.upTo) })).sort((a, b) => b.upTo - a.upTo);
}
