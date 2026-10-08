// Где лежат находки экземпляра (docs/GAMEPLAY.md, «Где лежат находки»).
//
//  • Предмет на споте (content.kind 'item') — в точке спота; если спот попал на мебель — на ней / в ней.
//  • Лут с decorId (строка тира с where: «сервант», «бутылки»…) — в этой мебели: центр по плану, несколько
//    находок в одной мебели — вдоль её ширины; высота — внутри (середина высоты) у высокой мебели, сверху у низкой.
//  • Остальной лут — на полу: клетки, где может стоять центр капсулы игрока и откуда достижимы двери
//    (src/gen/walk.ts), но не у проёмов и не на путях между ними; в первую очередь — у стен и мебели. В тесных
//    комнатах (санузел, кладовка) — ещё и «на расстоянии руки» от такого места. Выбор детерминирован (ГСЧ от
//    места экземпляра и номера находки), находки разнесены.
import { propHeightM } from '../blockout/core';
import type { RunExport, RunInstance } from '../blockout/types';
import { isFlatProp, walkCheck, type WalkProp, type WalkResult } from '../gen/walk';
import { makeRng, type Rng } from '../model/rng';
import type { CellKey, Prop, Room } from '../model/types';
import type { Pickup } from './types';

/** Находка на полу — не ближе к пути центра капсулы между проёмами, м. */
export const PATH_CLEAR_M = 0.5;
/** … и к линии проёма, м (не лежит в дверях). */
export const DOOR_CLEAR_M = 0.6;
/** Находки на полу одной комнаты — не ближе друг к другу (если хватает места), м. */
export const SPREAD_M = 0.7;
/** Находка «на расстоянии руки»: не дальше от места, где может стоять центр капсулы, м. */
export const REACH_M = 0.6;
/** Находка на полу не ближе к стене и мебели, м (не «влипает» в геометрию). */
export const ITEM_CLEAR_M = 0.15;
/** Мебель от этой высоты — находка внутри, на середине высоты (полка серванта, шкафа); ниже — сверху (стол, ящик). */
export const INSIDE_FROM_M = 1.2;

/** Класс центра клетки для лута на полу (чем больше, тем раньше выбирается). */
export const Slot = {
  /** не годится: стена, мебель, далеко от проходимого, вне комнаты */
  None: 0,
  /** у проёма (ближе DOOR_CLEAR_M) */
  Door: 1,
  /** на пути между проёмами (ближе PATH_CLEAR_M) */
  Path: 2,
  /** капсула сюда не встаёт, но рукой достать (REACH_M), до стены и мебели ≥ ITEM_CLEAR_M */
  Reach: 3,
  /** центр капсулы встаёт */
  Free: 4,
  /** центр капсулы встаёт, рядом стена или мебель — сюда в первую очередь */
  Wall: 5,
} as const;

export interface FloorPlan {
  /** клетки [x0, x0 + w) × [y0, y0 + h) — как у решётки walk.ts */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** класс центра клетки (x0 + i, y0 + j): индекс i + j·w, значения Slot */
  cls: Uint8Array;
  /** расстояние от центра клетки до ближайшего пути между проёмами, клетки (Infinity — далеко) */
  pathDist: Float32Array;
  /** расстояние от центра клетки до ближайшей линии проёма, клетки (Infinity — далеко) */
  doorDist: Float32Array;
  /** пути центра капсулы между парами проёмов (от середины к середине, натянутые ломаные): [x, y, x, y, …], мировые клетки */
  paths: number[][];
  /** проходимость для капсулы игрока (walk.ts) */
  walk: WalkResult;
  /** сколько клеток вне проёмов и путей (Reach + Free + Wall) — основной выбор */
  primary: number;
}

/** Высота находки в мебели высотой h, м: внутри (середина) у высокой, сверху у низкой. */
export function zInProp(h: number): number {
  return h >= INSIDE_FROM_M ? r3(h / 2) : r3(h);
}

const r3 = (v: number): number => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
};

// ───────────────────────── адаптер RunInstance → Room для walk.ts ─────────────────────────

const SEG_RE = /^(-?\d+)(?:-(-?\d+))?$/;
const cellsCache = new WeakMap<readonly string[], Set<CellKey>>();

/** Клетки экземпляра из сжатых рядов "y:x1-x2,x3" (кэш по массиву рядов). */
export function decodeCells(rows: readonly string[]): Set<CellKey> {
  let s = cellsCache.get(rows);
  if (s) return s;
  s = new Set<CellKey>();
  for (const row of rows ?? []) {
    const i = typeof row === 'string' ? row.indexOf(':') : -1;
    const y = i > 0 ? Number(row.slice(0, i)) : NaN;
    if (!Number.isInteger(y)) continue;
    for (const part of row.slice(i + 1).split(',')) {
      const m = SEG_RE.exec(part.trim());
      if (!m) continue;
      const a = +m[1], b = m[2] !== undefined ? +m[2] : a;
      for (let x = Math.min(a, b); x <= Math.max(a, b); x++) s.add(`${x},${y}`);
    }
  }
  cellsCache.set(rows, s);
  return s;
}

/** Комната в мировых координатах из экземпляра экспорта (клетки, проёмы, декор) — вход walkCheck. */
export function roomOfInstance(inst: RunInstance): Room {
  return {
    id: inst.roomId,
    name: inst.roomName,
    tags: inst.roomTags ?? [],
    unique: false,
    gen: { weight: 0, min: 0, max: 0 },
    cells: decodeCells(inst.cells),
    doors: (inst.doors ?? []).map(({ id, cx, cy, side, len }) => ({ id, cx, cy, side, len })),
    connectors: (inst.connectors ?? []).map(({ id, name, tag, cx, cy, side, len }) => ({ id, name, tag, cx, cy, side, len })),
    decor: (inst.decor ?? []).map(({ id, propId, x, y, rot }) => ({ id, propId, x, y, rot })),
    spots: [],
    spotGroups: [],
    loot: [],
    elite: [],
    note: '',
    finish: { wall: null, floor: null },
  };
}

type RunProp = RunExport['props'][number];
const propMaps = new WeakMap<readonly RunProp[], Map<string, Prop>>();

function propMap(run: RunExport): Map<string, Prop> {
  const list = run.props ?? [];
  let m = propMaps.get(list);
  if (!m) {
    m = new Map(list.map((x) => [x.id, { ...x, tex: x.tex ?? null, tags: x.tags ?? [] } as Prop] as const));
    propMaps.set(list, m);
  }
  return m;
}

/** Напольные prop, выпавшие на спотах (препятствия поверх декора). */
function spotProps(inst: RunInstance): WalkProp[] {
  const out: WalkProp[] = [];
  for (const s of inst.spots ?? []) {
    if (s.content?.kind !== 'prop') continue;
    out.push({ propId: s.content.id, x: s.x, y: s.y, rot: s.contentRot ?? s.rot + (s.content.rot ?? 0) });
  }
  return out;
}

// ───────────────────────── план пола ─────────────────────────

/** Простая двоичная куча (минимум по ключу) для Дейкстры. */
class Heap {
  private k = new Float64Array(64);
  private v = new Int32Array(64);
  size = 0;
  push(key: number, val: number): void {
    if (this.size === this.k.length) {
      const k = new Float64Array(this.size * 2), v = new Int32Array(this.size * 2);
      k.set(this.k);
      v.set(this.v);
      this.k = k;
      this.v = v;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p];
      this.v[i] = this.v[p];
      i = p;
    }
    this.k[i] = key;
    this.v[i] = val;
  }
  /** вершина: [ключ, значение] в out */
  pop(out: { key: number; val: number }): void {
    out.key = this.k[0];
    out.val = this.v[0];
    const key = this.k[--this.size], val = this.v[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= key) break;
      this.k[i] = this.k[c];
      this.v[i] = this.v[c];
      i = c;
    }
    this.k[i] = key;
    this.v[i] = val;
  }
}

const HALF_DIAG = Math.SQRT1_2;

/**
 * Решётка центров капсулы walk.ts: углы клеток [0, nC) и центры [nC, nC + nM). Шаги — как в walk.ts:
 * угол ↔ соседний угол (1), угол ↔ центр смежной клетки (√½).
 */
function dijkstra(g: WalkResult['grid'], free: (k: number) => boolean, seeds: readonly number[]): { dist: Float64Array; prev: Int32Array } {
  const W = g.w + 1, nC = W * (g.h + 1), n = nC + g.w * g.h;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new Heap();
  for (const s of seeds) {
    if (dist[s] === 0) continue;
    dist[s] = 0;
    heap.push(0, s);
  }
  const top = { key: 0, val: 0 };
  const relax = (from: number, to: number, c: number) => {
    if (!free(to)) return;
    const d = dist[from] + c;
    if (d < dist[to]) {
      dist[to] = d;
      prev[to] = from;
      heap.push(d, to);
    }
  };
  while (heap.size) {
    heap.pop(top);
    const k = top.val;
    if (top.key > dist[k]) continue;
    if (k < nC) {
      const i = k % W, j = (k - i) / W;
      if (i > 0) relax(k, k - 1, 1);
      if (i < g.w) relax(k, k + 1, 1);
      if (j > 0) relax(k, k - W, 1);
      if (j < g.h) relax(k, k + W, 1);
      for (let cj = j - 1; cj <= j; cj++) {
        if (cj < 0 || cj >= g.h) continue;
        for (let ci = i - 1; ci <= i; ci++) if (ci >= 0 && ci < g.w) relax(k, nC + ci + cj * g.w, HALF_DIAG);
      }
    } else {
      const m = k - nC;
      const i = m % g.w, j = (m - i) / g.w;
      const a = i + j * W;
      relax(k, a, HALF_DIAG);
      relax(k, a + 1, HALF_DIAG);
      relax(k, a + W, HALF_DIAG);
      relax(k, a + W + 1, HALF_DIAG);
    }
  }
  return { dist, prev };
}

/** Расстояние от точки до отрезка. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

/** Линия проёма в мировых клетках (углы клеток). */
function openingLine(o: { side: string; cx: number; cy: number; len: number }): [number, number, number, number] {
  switch (o.side) {
    case 'N': return [o.cx, o.cy, o.cx + o.len, o.cy];
    case 'S': return [o.cx, o.cy + 1, o.cx + o.len, o.cy + 1];
    case 'W': return [o.cx, o.cy, o.cx, o.cy + o.len];
    default: return [o.cx + 1, o.cy, o.cx + 1, o.cy + o.len];
  }
}

const planCache = new WeakMap<RunInstance, { props: unknown; cellM: number; plan: FloorPlan }>();

/**
 * План пола экземпляра для лута: проходимость (walk.ts, капсула 0.3 м, декор и prop на спотах — препятствия),
 * натянутые пути центра капсулы между всеми парами проёмов и классы клеток (Slot). Кэш по объекту экземпляра.
 */
export function floorPlan(run: RunExport, inst: RunInstance): FloorPlan {
  const cellM = run.cellM > 0 ? run.cellM : 0.1;
  const hit = planCache.get(inst);
  if (hit && hit.props === run.props && hit.cellM === cellM) return hit.plan;

  const room = roomOfInstance(inst);
  const walk = walkCheck(room, propMap(run), spotProps(inst), { cellM });
  const g = walk.grid;
  const { x0, y0, w, h } = g;
  const W = w + 1, nC = W * (h + 1);
  let hasMain = false;
  for (let m = 0; m < w * h && !hasMain; m++) if (g.cell[m] === 2) hasMain = true;
  const want = hasMain ? 2 : 1;
  const free = (k: number) => (k < nC ? g.corner[k] : g.cell[k - nC]) >= 1;
  const pos = (k: number): [number, number] => {
    if (k < nC) {
      const i = k % W;
      return [x0 + i, y0 + (k - i) / W];
    }
    const m = k - nC, i = m % w;
    return [x0 + i + 0.5, y0 + (m - i) / w + 0.5];
  };
  /** точка (x, y) свободна для центра капсулы — по ближайшему узлу решётки */
  const freeAt = (x: number, y: number): boolean => {
    const rx = Math.round(x), ry = Math.round(y);
    const fx = Math.floor(x), fy = Math.floor(y);
    const dC = (x - rx) ** 2 + (y - ry) ** 2, dM = (x - fx - 0.5) ** 2 + (y - fy - 0.5) ** 2;
    if (dC <= dM) {
      const i = rx - x0, j = ry - y0;
      return i >= 0 && j >= 0 && i <= w && j <= h && g.corner[i + j * W] >= 1;
    }
    const i = fx - x0, j = fy - y0;
    return i >= 0 && j >= 0 && i < w && j < h && g.cell[i + j * w] >= 1;
  };
  const los = (ax: number, ay: number, bx: number, by: number): boolean => {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25);
    for (let s = 1; s < n; s++) if (!freeAt(ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n)) return false;
    return true;
  };

  // пути между парами проёмов: Дейкстра по решётке walk.ts от середины линии проёма до середины другого,
  // затем «натянуть» ломаную (так ходит игрок — через середины дверей)
  const anchors = walk.openings.map((o) => {
    if (!o.stand) return -1;
    const [ax, ay, bx] = openingLine(o);
    const vert = ax === bx;
    let best = -1, bd = Infinity;
    for (let t = 0; t <= o.len; t++) {
      const i = (vert ? ax : ax + t) - x0, j = (vert ? ay + t : ay) - y0;
      if (i < 0 || j < 0 || i > w || j > h || g.corner[i + j * W] < 1) continue;
      const d = Math.abs(t - o.len / 2);
      if (d < bd) { bd = d; best = i + j * W; }
    }
    return best;
  });
  const paths: number[][] = [];
  for (let a = 0; a < anchors.length - 1; a++) {
    if (anchors[a] < 0) continue;
    const { dist, prev } = dijkstra(g, free, [anchors[a]]);
    for (let b = a + 1; b < anchors.length; b++) {
      const end = anchors[b];
      if (end < 0 || dist[end] === Infinity) continue;
      const pts: [number, number][] = [];
      for (let k = end; k >= 0; k = prev[k]) pts.push(pos(k));
      const line: number[] = [pts[0][0], pts[0][1]];
      for (let i = 0; i < pts.length - 1;) {
        let j = i + 1;
        while (j + 1 < pts.length && los(pts[i][0], pts[i][1], pts[j + 1][0], pts[j + 1][1])) j++;
        line.push(pts[j][0], pts[j][1]);
        i = j;
      }
      paths.push(line);
    }
  }
  // в зону прохода — и прямой отрезок между серединами проёмов, если он свободен: так идёт игрок, видя дверь
  // напротив, а натянутая ломаная от углов решётки может отойти от него на полклетки (в paths плана его нет)
  const straight: number[][] = [];
  const mids = walk.openings.filter((o) => o.stand).map((o) => {
    const [ax, ay, bx, by] = openingLine(o);
    return [(ax + bx) / 2, (ay + by) / 2] as const;
  });
  for (let a = 0; a < mids.length; a++) {
    for (let b = a + 1; b < mids.length; b++) {
      if (los(mids[a][0], mids[a][1], mids[b][0], mids[b][1])) straight.push([mids[a][0], mids[a][1], mids[b][0], mids[b][1]]);
    }
  }

  // расстояние до путей и зоны проёмов (по центрам клеток)
  const pathDist = new Float32Array(w * h).fill(Infinity);
  const rp = PATH_CLEAR_M / cellM, rd = DOOR_CLEAR_M / cellM;
  const stampSeg = (out: Float32Array, ax: number, ay: number, bx: number, by: number, r: number) => {
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - x0)), i1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r - x0));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by) - r - y0)), j1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r - y0));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = segDist(x0 + i + 0.5, y0 + j + 0.5, ax, ay, bx, by);
        if (d < out[i + j * w]) out[i + j * w] = d;
      }
    }
  };
  for (const line of [...paths, ...straight]) {
    for (let s = 0; s + 3 < line.length; s += 2) stampSeg(pathDist, line[s], line[s + 1], line[s + 2], line[s + 3], rp);
    if (line.length === 2) stampSeg(pathDist, line[0], line[1], line[0], line[1], rp);
  }
  const doorDist = new Float32Array(w * h).fill(Infinity);
  for (const o of walk.openings) {
    const [ax, ay, bx, by] = openingLine(o);
    stampSeg(doorDist, ax, ay, bx, by, rd);
  }

  // «рукой достать»: клетки пола, свободные для диска ITEM_CLEAR_M, не дальше REACH_M (по полу комнаты)
  // от места, где встаёт центр капсулы
  const inRoom = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (room.cells.has(`${x0 + i},${y0 + j}`)) inRoom[i + j * w] = 1;
  const gi = walkCheck(room, propMap(run), spotProps(inst), { cellM, radiusM: ITEM_CLEAR_M }).grid;
  const itemFree = (i: number, j: number): boolean => {
    const ii = x0 + i - gi.x0, jj = y0 + j - gi.y0;
    return ii >= 0 && jj >= 0 && ii < gi.w && jj < gi.h && gi.cell[ii + jj * gi.w] >= 1;
  };
  const reach = new Float64Array(w * h).fill(Infinity);
  {
    const heap = new Heap();
    for (let m = 0; m < w * h; m++) if (g.cell[m] === want && inRoom[m]) { reach[m] = 0; heap.push(0, m); }
    const rr = REACH_M / cellM, top = { key: 0, val: 0 };
    while (heap.size) {
      heap.pop(top);
      const m = top.val;
      if (top.key > reach[m] || top.key >= rr) continue;
      const i = m % w, j = (m - i) / w;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ci = i + di, cj = j + dj;
          if ((!di && !dj) || ci < 0 || cj < 0 || ci >= w || cj >= h) continue;
          const n = ci + cj * w;
          if (!inRoom[n]) continue;
          const d = top.key + (di && dj ? Math.SQRT2 : 1);
          if (d < reach[n]) { reach[n] = d; heap.push(d, n); }
        }
      }
    }
    for (let m = 0; m < w * h; m++) if (reach[m] > rr + 1e-9) reach[m] = Infinity;
  }

  const cls = new Uint8Array(w * h);
  let primary = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const m = i + j * w;
      if (!inRoom[m]) continue;
      const stand = g.cell[m] === want;
      if (!stand && !(reach[m] < Infinity && itemFree(i, j))) continue;
      if (doorDist[m] < rd) { cls[m] = Slot.Door; continue; }
      if (pathDist[m] < rp) { cls[m] = Slot.Path; continue; }
      primary++;
      if (!stand) { cls[m] = Slot.Reach; continue; }
      // у стены / мебели: в пределах 2 клеток есть точка, где капсула не встаёт
      let wall = false;
      for (let dj = -2; dj <= 2 && !wall; dj++) {
        for (let di = -2; di <= 2; di++) {
          const ci = i + di, cj = j + dj;
          if (ci < 0 || cj < 0 || ci >= w || cj >= h || g.cell[ci + cj * w] === 0) { wall = true; break; }
        }
      }
      cls[m] = wall ? Slot.Wall : Slot.Free;
    }
  }

  const plan: FloorPlan = { x0, y0, w, h, cls, pathDist, doorDist, paths, walk, primary };
  planCache.set(inst, { props: run.props, cellM, plan });
  return plan;
}

// ───────────────────────── выбор точек ─────────────────────────

type Pt = [number, number];

const minDist2 = (x: number, y: number, placed: readonly Pt[]): number => {
  let best = Infinity;
  for (const [px, py] of placed) {
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < best) best = d;
  }
  return best;
};

const pools = new WeakMap<FloorPlan, number[][]>();

/** Клетки плана по классам Slot (индексы по возрастанию). */
function poolsOf(plan: FloorPlan): number[][] {
  let by = pools.get(plan);
  if (!by) {
    by = [[], [], [], [], [], []];
    for (let m = 0; m < plan.cls.length; m++) if (plan.cls[m]) by[plan.cls[m]].push(m);
    pools.set(plan, by);
  }
  return by;
}

/**
 * Точка на полу для очередной находки. По очереди, пока не найдётся клетка не ближе SPREAD_M к уже положенным
 * (случайная из подходящих): у стен/мебели → остальное свободное → «рукой достать»; затем то же с половиной
 * SPREAD_M; затем клетки у проёмов и на путях (не ближе SPREAD_M / 2) — лучшая четверть по тому, насколько они
 * залезли в зону. Не нашлось — самая удалённая от положенных клетка (вне зон, если такие есть). Капсула нигде
 * не встаёт — любая клетка комнаты.
 */
function pickFloor(plan: FloorPlan, cells: ReadonlySet<CellKey>, placed: readonly Pt[], rng: Rng, cellM: number): Pt {
  const { x0, y0, w, h, pathDist, doorDist } = plan;
  const ctr = (m: number): Pt => [x0 + (m % w) + 0.5, y0 + Math.floor(m / w) + 0.5];
  const by = poolsOf(plan);
  const far = (pool: readonly number[], spreadM: number): number[] => {
    const s2 = (spreadM / cellM) ** 2;
    return pool.filter((m) => {
      const [x, y] = ctr(m);
      return minDist2(x, y, placed) >= s2;
    });
  };
  const maxMin = (pool: readonly number[]): Pt => {
    if (placed.length === 0) return ctr(pool[rng.int(0, pool.length - 1)]);
    let best = pool[0], bd = -1;
    for (const m of pool) {
      const [x, y] = ctr(m);
      const d = minDist2(x, y, placed);
      if (d > bd) { bd = d; best = m; }
    }
    return ctr(best);
  };
  const main = [by[Slot.Wall], by[Slot.Free], by[Slot.Reach]];
  for (const spreadM of [SPREAD_M, SPREAD_M / 2]) {
    for (const pool of main) {
      const f = far(pool, spreadM);
      if (f.length) return ctr(f[rng.int(0, f.length - 1)]);
    }
  }
  // тесная комната (санузел, прихожая): подальше и от проёмов, и от путей
  const near = by[Slot.Path].concat(by[Slot.Door]);
  const rp = PATH_CLEAR_M / cellM, rd = DOOR_CLEAR_M / cellM;
  const bad = (m: number) => Math.max(0, 1 - pathDist[m] / rp) + Math.max(0, 1 - doorDist[m] / rd);
  const sorted = near.map((m) => [bad(m), m] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[1]);
  const f = far(sorted, SPREAD_M / 2);
  if (f.length) return ctr(f[rng.int(0, Math.min(f.length, Math.max(16, Math.ceil(f.length / 4))) - 1)]);
  const all = main.flat();
  if (all.length) return maxMin(all);
  if (sorted.length) return maxMin(sorted);
  const any: number[] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (cells.has(`${x0 + i},${y0 + j}`)) any.push(i + j * w);
  return any.length ? maxMin(any) : [x0 + w / 2, y0 + h / 2];
}

/** Ключ ГСЧ находки на полу: место экземпляра (не id — в бесконечном мире id зависят от порядка обхода). */
function placeKey(inst: RunInstance, index: number): string {
  return `${inst.roomId}@${inst.dx},${inst.dy},${inst.rot},${inst.w ?? 0},${inst.floor ?? 0}#loot:${index}`;
}

interface Box {
  x: number;
  y: number;
  rot: number;
  /** полуразмеры, клетки */
  hw: number;
  hh: number;
  /** высота, м */
  h: number;
}

function boxOf(props: Map<string, Prop>, propId: string, x: number, y: number, rot: number, cellM: number): Box {
  const p = props.get(propId);
  return {
    x,
    y,
    rot,
    hw: p ? p.w / cellM / 2 : 0,
    hh: p ? p.h / cellM / 2 : 0,
    h: p ? propHeightM(p.tags ?? [], p.name ?? '') : 0.8,
  };
}

const inBox = (b: Box, px: number, py: number): boolean => {
  const t = (b.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = px - b.x, dy = py - b.y;
  return Math.abs(dx * c + dy * s) <= b.hw + 1e-9 && Math.abs(-dx * s + dy * c) <= b.hh + 1e-9;
};

/** Находки экземпляра (реализация pickupsOf, см. state.ts). */
export function placePickups(run: RunExport, inst: RunInstance): Pickup[] {
  const cellM = run.cellM > 0 ? run.cellM : 0.1;
  const props = propMap(run);
  const out: Pickup[] = [];

  // мебель экземпляра (не плоская): декор и prop на спотах — для высоты предметов на спотах
  const solids: Box[] = [];
  for (const d of inst.decor ?? []) {
    const p = props.get(d.propId);
    if (p && !isFlatProp(p)) solids.push(boxOf(props, d.propId, d.x, d.y, d.rot, cellM));
  }
  for (const sp of spotProps(inst)) {
    const p = props.get(sp.propId);
    if (p && !isFlatProp(p)) solids.push(boxOf(props, sp.propId, sp.x, sp.y, sp.rot, cellM));
  }

  // 1. предметы на спотах
  const placed: Pt[] = [];
  for (const s of inst.spots ?? []) {
    if (s.content?.kind !== 'item') continue;
    let z = 0;
    for (const b of solids) if (inBox(b, s.x, s.y)) z = Math.max(z, zInProp(b.h));
    out.push({ id: `${inst.id}:spot:${s.id}`, inst: inst.id, itemId: s.content.id, count: 1, x: r3(s.x), y: r3(s.y), z, from: 'spot' });
    if (z === 0) placed.push([s.x, s.y]);
  }

  // 2. лут: в мебели (decorId) или на полу
  const loot = inst.loot ?? [];
  const where = new Map<number, Box>();
  const perDecor = new Map<string, number[]>();
  loot.forEach((l, i) => {
    if (!l.decorId) return;
    let box: Box | null = null;
    if (l.decorId.startsWith('spot:')) {
      const s = (inst.spots ?? []).find((x) => x.id === l.decorId!.slice(5));
      if (s?.content?.kind === 'prop') box = boxOf(props, s.content.id, s.x, s.y, s.contentRot ?? s.rot + (s.content.rot ?? 0), cellM);
    } else {
      const d = (inst.decor ?? []).find((x) => x.id === l.decorId);
      if (d) box = boxOf(props, d.propId, d.x, d.y, d.rot, cellM);
    }
    if (!box) return; // мебели нет (устаревший экспорт) — на пол
    where.set(i, box);
    const list = perDecor.get(l.decorId) ?? [];
    list.push(i);
    perDecor.set(l.decorId, list);
  });

  let plan: FloorPlan | null = null;
  loot.forEach((l, i) => {
    const base: Pickup = { id: `${inst.id}:loot:${i}`, inst: inst.id, itemId: l.itemId, count: l.count, x: 0, y: 0, z: 0, from: l.from === 'room' ? 'room' : 'tier' };
    if (l.shopId) base.shopId = l.shopId;
    const box = where.get(i);
    if (box) {
      // несколько находок в одной мебели — вдоль её ширины (70 %), не в одну точку
      const list = perDecor.get(l.decorId!)!;
      const k = list.indexOf(i), n = list.length;
      const t = ((k + 0.5) / n - 0.5) * box.hw * 2 * 0.7;
      const a = (box.rot * Math.PI) / 180;
      base.x = r3(box.x + t * Math.cos(a));
      base.y = r3(box.y + t * Math.sin(a));
      base.z = zInProp(box.h);
      base.decorId = l.decorId;
    } else {
      plan ??= floorPlan(run, inst);
      const [x, y] = pickFloor(plan, decodeCells(inst.cells), placed, makeRng(placeKey(inst, i)), cellM);
      placed.push([x, y]);
      base.x = r3(x);
      base.y = r3(y);
    }
    out.push(base);
  });
  return out;
}
