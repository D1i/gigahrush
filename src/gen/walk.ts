// Проходимость комнаты для игрока (капсула радиусом 0.3 м) — docs/GENERATOR.md, «Проходимость».
//
// Модель. Центр капсулы живёт на двух решётках: углы клеток (X, Y) и центры клеток (X + ½, Y + ½).
// Точка свободна, если круг радиуса R вокруг неё не задевает ни стену (клетку вне пола), ни
// препятствие (прямоугольник prop с учётом поворота; «плоские» — ковры, высота < 0.1 м — не мешают).
// Перед каждым проёмом пол продлевается наружу на R («створ»), поэтому центр капсулы может встать
// прямо на линии проёма — если проём не уже 2R и изнутри к нему не придвинута мебель.
// Шаги: угол ↔ соседний угол (по осям), угол ↔ центр соседней клетки (по диагонали, через центр).
// Проходимо ⇔ все проёмы комнаты (двери и метки; совпадающие по геометрии — один проём) связаны.
// Для осевых щелей правило точное (0.6 м — проходимо, 0.59 — нет), для диагональных — с запасом ≤ 0.07 м.
import { parseKey } from '../model/cells';
import { propHeightM } from '../blockout/core';
import type { Assign, CellKey, InstanceContent, Project, Prop, Room, Segment, Side, SpotGroup, Variant } from '../model/types';

/** Радиус капсулы игрока, м (Babylon ellipsoid 0.3 / 0.85 / 0.3). */
export const PLAYER_RADIUS_M = 0.3;
// cellar: в погребе тело игрока — эллипс (плечи ±0.23, грудь ±0.13 м, src/view3d/cellarWalk.ts): щель 0.4 м проходят
// боком, поэтому проходимость комнат погреба — по полуглубине груди
/** Радиус «капсулы» в комнатах с тегом «погреб», м: боком — полуглубина груди. */
export const CELLAR_RADIUS_M = 0.13;
/** Радиус проверки проходимости комнаты по умолчанию: погреб — CELLAR_RADIUS_M, иначе PLAYER_RADIUS_M. */
export const walkRadiusM = (room: Pick<Room, 'tags'>): number => (room.tags.includes('погреб') ? CELLAR_RADIUS_M : PLAYER_RADIUS_M);
/** Ниже этой высоты prop не препятствие (ковёр 0.01 м), м. */
export const FLAT_HEIGHT_M = 0.1;
const FLAT_WORDS = ['ковер', 'коврик', 'половик', 'дорожка'];

/** Prop, поставленный в комнату: центр (клетки, как у декора), поворот по часовой. */
export interface WalkProp {
  propId: string;
  x: number;
  y: number;
  rot: number;
}

export interface WalkOpening {
  /** id метки (или двери, если метки с той же геометрией нет) */
  id: string;
  /** все id двери и меток с этой геометрией */
  ids: string[];
  /** подпись для человека: «имя метки» или «дверь N» */
  name: string;
  side: Side;
  cx: number;
  cy: number;
  len: number;
  /** центр капсулы может встать в створе и оттуда дойти до остальных проёмов */
  ok: boolean;
  /** центр капсулы вообще может встать в створе (иначе проём загорожен вплотную) */
  stand: boolean;
}

/** Состояние точки: 0 — центр капсулы встать не может; 1 — может, но от проёмов отрезан; 2 — достижимо. */
export interface WalkGrid {
  /** клетки [x0, x0 + w) × [y0, y0 + h) (с полем вокруг комнаты) */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** состояние центра клетки (x0 + i, y0 + j): индекс i + j·w */
  cell: Uint8Array;
  /** состояние угла (x0 + i, y0 + j), i ≤ w, j ≤ h: индекс i + j·(w + 1) */
  corner: Uint8Array;
}

export interface WalkResult {
  ok: boolean;
  /** id отрезанных проёмов (WalkOpening.id) */
  blockedDoors: string[];
  grid: WalkGrid;
  openings: WalkOpening[];
}

export interface WalkOpts {
  /** размер клетки, м (по умолчанию 0.1) */
  cellM?: number;
  /** радиус капсулы, м (по умолчанию walkRadiusM(комната): PLAYER_RADIUS_M, в погребе — CELLAR_RADIUS_M) */
  radiusM?: number;
}

export type PropLookup = ReadonlyMap<string, Prop> | Readonly<Record<string, Prop>>;

/** Быстрый разбор ключа "x,y" в out[o], out[o + 1] (горячий путь: тысячи клеток). */
function parseCell(k: string, out: Int32Array, o: number): void {
  let i = 0, x = 0, y = 0, neg = false;
  const n = k.length;
  if (k.charCodeAt(0) === 45) { neg = true; i = 1; }
  for (; i < n; i++) {
    const c = k.charCodeAt(i);
    if (c === 44) break;
    if (c < 48 || c > 57) { const [px, py] = parseKey(k); out[o] = px; out[o + 1] = py; return; }
    x = x * 10 + (c - 48);
  }
  out[o] = neg ? -x : x;
  i++;
  neg = false;
  if (k.charCodeAt(i) === 45) { neg = true; i++; }
  for (; i < n; i++) {
    const c = k.charCodeAt(i);
    if (c < 48 || c > 57) { const [px, py] = parseKey(k); out[o] = px; out[o + 1] = py; return; }
    y = y * 10 + (c - 48);
  }
  out[o + 1] = neg ? -y : y;
}

const getProp = (props: PropLookup, id: string): Prop | undefined =>
  props instanceof Map ? props.get(id) : (props as Record<string, Prop>)[id];

// ───────────────────────── плоские prop ─────────────────────────

const flatCache = new Map<string, boolean>();

/** Prop не мешает ходьбе: ковёр/коврик/половик/дорожка или высота болванки < 0.1 м. */
export function isFlatProp(p: Pick<Prop, 'tags' | 'name'>): boolean {
  const key = `${(p.tags ?? []).join('|')}#${p.name ?? ''}`;
  let v = flatCache.get(key);
  if (v === undefined) {
    const words = `${(p.tags ?? []).join(' ')} ${p.name ?? ''}`.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/);
    v = words.some((w) => FLAT_WORDS.includes(w)) || propHeightM(p.tags ?? [], p.name ?? '') < FLAT_HEIGHT_M;
    if (flatCache.size > 2000) flatCache.clear();
    flatCache.set(key, v);
  }
  return v;
}

/** Напольные (не плоские) prop варианта группы: позиции спотов в координатах комнаты. */
export function variantFloorProps(room: Room, g: SpotGroup, v: Variant, props: PropLookup): WalkProp[] {
  const out: WalkProp[] = [];
  for (const s of room.spots) {
    if (s.groupId !== g.id) continue;
    const a = v.assign[s.id];
    if (!a || a.kind !== 'prop') continue;
    const pr = getProp(props, a.id);
    if (!pr || isFlatProp(pr)) continue;
    out.push({ propId: a.id, x: s.x, y: s.y, rot: s.rot + a.rot });
  }
  return out;
}

// ───────────────────────── базовая решётка (пол + створы) ─────────────────────────

interface OpeningGeo {
  key: string;
  ids: string[];
  name: string;
  side: Side;
  cx: number;
  cy: number;
  len: number;
  /** индексы углов на линии проёма */
  seeds: Int32Array;
}

interface Free {
  /** углы, (w + 1)·(h + 1) */
  c: Uint8Array;
  /** центры клеток, w·h */
  m: Uint8Array;
}

interface StaticGrid {
  free: Free;
  /** результаты по набору дополнительных prop (ключ — их сигнатура) */
  memo: Map<string, WalkResult>;
}

interface Base {
  keys: CellKey[];
  sig: string;
  /** клетки [x0, x0 + w) × [y0, y0 + h) */
  x0: number;
  y0: number;
  w: number;
  h: number;
  R: number;
  free: Free;
  openings: OpeningGeo[];
  /** сигнатура фиксированного декора → решётка с декором */
  statics: Map<string, StaticGrid>;
}

const baseCache = new WeakMap<Set<CellKey>, Base>();
const MEMO_CAP = 96;
const STATIC_CAP = 16;
const SIDE_OUT: Record<Side, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

function openingsOf(room: Room): Omit<OpeningGeo, 'seeds'>[] {
  const out: Omit<OpeningGeo, 'seeds'>[] = [];
  const byKey = new Map<string, Omit<OpeningGeo, 'seeds'>>();
  const add = (s: Segment, name: string | null) => {
    if (!(s.len >= 1)) return;
    const key = `${s.side}:${s.cx}:${s.cy}:${s.len}`;
    const o = byKey.get(key);
    if (o) {
      o.ids.push(s.id);
      return;
    }
    const n: Omit<OpeningGeo, 'seeds'> = { key, ids: [s.id], name: name ?? `«дверь ${out.length + 1}»`, side: s.side, cx: s.cx, cy: s.cy, len: s.len };
    byKey.set(key, n);
    out.push(n);
  };
  // сначала метки (у них имена; id метки — основной), затем двери с другой геометрией
  for (const c of room.connectors) add(c, `«${c.name || c.tag || c.id}»`);
  for (const d of room.doors) add(d, null);
  return out;
}

/**
 * Окно круга радиуса R для точки со смещением off (0 — угол, ½ — центр клетки): по строкам клеток
 * oy — диапазон столбцов [a, b] относительно клетки точки, где клетка ближе R.
 */
function discRows(R: number, off: number): Int32Array {
  const R2 = R * R - 1e-9;
  const K = Math.ceil(R + 1);
  const rows: number[] = [];
  // расстояние по оси от точки (координата off внутри клетки 0) до клетки o: [o, o + 1]
  const dist = (o: number) => (o + 1 <= off ? off - (o + 1) : o >= off ? o - off : 0);
  for (let oy = -K; oy <= K; oy++) {
    const dy = dist(oy);
    if (dy * dy >= R2) continue;
    let a = 0, b = 0;
    while (dist(a - 1) ** 2 + dy * dy < R2) a--;
    while (dist(b + 1) ** 2 + dy * dy < R2) b++;
    rows.push(oy, a, b);
  }
  return Int32Array.from(rows);
}

function baseOf(room: Room, cellM: number, radiusM: number): Base {
  const ops = openingsOf(room);
  const sig = `${cellM}|${radiusM}|${ops.map((o) => `${o.key}=${o.name}=${o.ids.join(',')}`).join(';')}`;
  const cells = room.cells;
  const cached = baseCache.get(cells);
  if (cached && cached.sig === sig && cached.keys.length === cells.size) {
    let i = 0;
    let same = true;
    for (const k of cells) if (k !== cached.keys[i++]) { same = false; break; }
    if (same) return cached;
  }

  const R = radiusM / cellM;
  const S = Math.ceil(R - 1e-9);
  const keys: CellKey[] = new Array(cells.size);
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  const pts = new Int32Array(cells.size * 2);
  let n = 0;
  for (const k of cells) {
    keys[n] = k;
    parseCell(k, pts, 2 * n);
    const x = pts[2 * n], y = pts[2 * n + 1];
    n++;
    if (x < bx0) bx0 = x;
    if (y < by0) by0 = y;
    if (x + 1 > bx1) bx1 = x + 1;
    if (y + 1 > by1) by1 = y + 1;
  }
  if (bx0 === Infinity) { bx0 = by0 = 0; bx1 = by1 = 1; }
  // поле S + 1 вокруг комнаты: там помещаются створы, края — «стена»
  const x0 = bx0 - S - 1, y0 = by0 - S - 1;
  const w = bx1 - bx0 + 2 * S + 2, h = by1 - by0 + 2 * S + 2;
  const floor = new Uint8Array(w * h);
  for (let i = 0; i < n * 2; i += 2) floor[(pts[i] - x0) + (pts[i + 1] - y0) * w] = 1;
  const inGrid = (x: number, y: number) => x >= x0 && y >= y0 && x < x0 + w && y < y0 + h;

  // створы: клетки снаружи проёма на глубину S (до первой клетки самой комнаты)
  const stub: number[] = [];
  for (const o of ops) {
    const [dx, dy] = SIDE_OUT[o.side];
    const horiz = o.side === 'N' || o.side === 'S';
    for (let i = 0; i < o.len; i++) {
      const sx = horiz ? o.cx + i : o.cx, sy = horiz ? o.cy : o.cy + i;
      for (let k = 1; k <= S; k++) {
        const x = sx + dx * k, y = sy + dy * k;
        if (!inGrid(x, y) || cells.has(`${x},${y}`)) break;
        stub.push((x - x0) + (y - y0) * w);
      }
    }
  }
  for (const i of stub) floor[i] = 1;

  // префиксные суммы «не пол» по строкам клеток
  const pre = new Int32Array((w + 1) * h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    const row = y * (w + 1);
    for (let x = 0; x < w; x++) {
      s += floor[x + y * w] ? 0 : 1;
      pre[row + x + 1] = s;
    }
  }
  /** точки у клеток (i, j), i < gw, j < gh, свободные при окне rows (клетки вне сетки — стена) */
  const erode = (gw: number, gh: number, rows: Int32Array): Uint8Array => {
    const out = new Uint8Array(gw * gh);
    const nr = rows.length;
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        let ok = 1;
        for (let r = 0; r < nr; r += 3) {
          const cy = j + rows[r], ca = i + rows[r + 1], cb = i + rows[r + 2];
          if (cy < 0 || cy >= h || ca < 0 || cb >= w) { ok = 0; break; }
          const row = cy * (w + 1);
          if (pre[row + cb + 1] !== pre[row + ca]) { ok = 0; break; }
        }
        out[i + j * gw] = ok;
      }
    }
    return out;
  };
  const fc = erode(w + 1, h + 1, discRows(R, 0));
  const fm = erode(w, h, discRows(R, 0.5));

  const openings: OpeningGeo[] = ops.map((o) => {
    const seeds: number[] = [];
    const horiz = o.side === 'N' || o.side === 'S';
    // линия проёма в координатах углов
    const line = o.side === 'N' ? o.cy : o.side === 'S' ? o.cy + 1 : o.side === 'W' ? o.cx : o.cx + 1;
    for (let t = 0; t <= o.len; t++) {
      const i = (horiz ? o.cx + t : line) - x0, j = (horiz ? line : o.cy + t) - y0;
      if (i >= 0 && j >= 0 && i <= w && j <= h) seeds.push(i + j * (w + 1));
    }
    return { ...o, seeds: Int32Array.from(seeds) };
  });

  const base: Base = { keys, sig, x0, y0, w, h, R, free: { c: fc, m: fm }, openings, statics: new Map() };
  baseCache.set(cells, base);
  return base;
}

// ───────────────────────── препятствия ─────────────────────────

/** Закрыть точки решётки (углы: off = 0, центры: off = ½) ближе R к прямоугольнику prop. */
function stampGrid(free: Uint8Array, gw: number, gh: number, ox: number, oy: number,
  cx: number, cy: number, c: number, s: number, hw: number, hh: number, R: number): void {
  const ac = Math.abs(c), as = Math.abs(s);
  const ex = ac * hw + as * hh + R, ey = as * hw + ac * hh + R;
  const i0 = Math.max(0, Math.ceil(cx - ex - ox)), i1 = Math.min(gw - 1, Math.floor(cx + ex - ox));
  const j0 = Math.max(0, Math.ceil(cy - ey - oy)), j1 = Math.min(gh - 1, Math.floor(cy + ey - oy));
  // касание ровно на R — ещё проходимо
  const R2 = R * R - 1e-6;
  for (let j = j0; j <= j1; j++) {
    const dy = j + oy - cy;
    const row = j * gw;
    for (let i = i0; i <= i1; i++) {
      const k = row + i;
      if (!free[k]) continue;
      const dx = i + ox - cx;
      // в локальные оси prop (поворот по часовой при оси Y вниз)
      const qx = Math.abs(dx * c + dy * s) - hw;
      const qy = Math.abs(-dx * s + dy * c) - hh;
      const d2 = (qx > 0 ? qx * qx : 0) + (qy > 0 ? qy * qy : 0);
      if (d2 < R2) free[k] = 0;
    }
  }
}

interface Solid {
  key: string;
  x: number;
  y: number;
  rot: number;
  hw: number;
  hh: number;
}

function stamp(b: Base, f: Free, sd: Solid): void {
  const t = (sd.rot * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  stampGrid(f.c, b.w + 1, b.h + 1, b.x0, b.y0, sd.x, sd.y, c, s, sd.hw, sd.hh, b.R);
  stampGrid(f.m, b.w, b.h, b.x0 + 0.5, b.y0 + 0.5, sd.x, sd.y, c, s, sd.hw, sd.hh, b.R);
}

/** catacombs: трубы поперёк хода — через них перелезают (E, тег prop 'перелаз') или проходят под ними пригнувшись
 *  ('пригнуться'): в плане проход не перегораживают. */
const OVER_TAGS = ['перелаз', 'пригнуться'];

/** Препятствия из списка: плоские, неизвестные и перелазы (catacombs) prop отбрасываются. */
function solidsOf(list: readonly WalkProp[], props: PropLookup, cellM: number): Solid[] {
  const out: Solid[] = [];
  for (const d of list) {
    const p = getProp(props, d.propId);
    if (!p || isFlatProp(p) || OVER_TAGS.some((t) => p.tags?.includes(t))) continue;
    const hw = p.w / cellM / 2, hh = p.h / cellM / 2;
    if (!(hw > 0 && hh > 0)) continue;
    out.push({ key: `${d.propId}:${p.w}:${p.h}:${d.x}:${d.y}:${d.rot}`, x: d.x, y: d.y, rot: d.rot, hw, hh });
  }
  return out;
}

// ───────────────────────── связность ─────────────────────────

let scratch = new Int32Array(0);

function evaluate(b: Base, f: Free): WalkResult {
  const W = b.w + 1; // ширина решётки углов
  const nC = W * (b.h + 1), nM = b.w * b.h;
  // общая нумерация: углы [0, nC), центры [nC, nC + nM)
  const comp = new Int32Array(nC + nM).fill(-1);
  if (scratch.length < nC + nM) scratch = new Int32Array(nC + nM);
  const queue = scratch;
  const fc = f.c, fm = f.m, w = b.w, h = b.h;
  let nComp = 0;
  const touch: number[][] = b.openings.map(() => []);
  b.openings.forEach((o, oi) => {
    for (const s of o.seeds) {
      if (!fc[s]) continue;
      if (comp[s] < 0) {
        const id = nComp++;
        let qh = 0, qt = 0;
        queue[qt++] = s;
        comp[s] = id;
        const visit = (k: number) => { comp[k] = id; queue[qt++] = k; };
        while (qh < qt) {
          const k = queue[qh++];
          if (k < nC) {
            // угол (i, j): соседние углы и центры четырёх клеток вокруг
            const i = k % W, j = (k - i) / W;
            if (i > 0 && fc[k - 1] && comp[k - 1] < 0) visit(k - 1);
            if (i < w && fc[k + 1] && comp[k + 1] < 0) visit(k + 1);
            if (j > 0 && fc[k - W] && comp[k - W] < 0) visit(k - W);
            if (j < h && fc[k + W] && comp[k + W] < 0) visit(k + W);
            for (let dj = -1; dj <= 0; dj++) {
              const cj = j + dj;
              if (cj < 0 || cj >= h) continue;
              for (let di = -1; di <= 0; di++) {
                const ci = i + di;
                if (ci < 0 || ci >= w) continue;
                const m = ci + cj * w;
                if (fm[m] && comp[nC + m] < 0) visit(nC + m);
              }
            }
          } else {
            // центр клетки (i, j): её четыре угла
            const m = k - nC;
            const i = m % w, j = (m - i) / w;
            const a = i + j * W;
            if (fc[a] && comp[a] < 0) visit(a);
            if (fc[a + 1] && comp[a + 1] < 0) visit(a + 1);
            if (fc[a + W] && comp[a + W] < 0) visit(a + W);
            if (fc[a + W + 1] && comp[a + W + 1] < 0) visit(a + W + 1);
          }
        }
      }
      if (!touch[oi].includes(comp[s])) touch[oi].push(comp[s]);
    }
  });
  // основная компонента — та, которой касается больше всего проёмов (при равенстве — раньше найденная)
  let main = -1;
  if (nComp > 0) {
    const cnt = new Int32Array(nComp);
    for (const t of touch) for (const c of t) cnt[c]++;
    for (let c = 0; c < nComp; c++) if (main < 0 || cnt[c] > cnt[main]) main = c;
  }
  const corner = new Uint8Array(nC);
  for (let k = 0; k < nC; k++) if (fc[k]) corner[k] = main >= 0 && comp[k] === main ? 2 : 1;
  const cell = new Uint8Array(nM);
  for (let m = 0; m < nM; m++) if (fm[m]) cell[m] = main >= 0 && comp[nC + m] === main ? 2 : 1;
  const openings: WalkOpening[] = b.openings.map((o, oi) => ({
    id: o.ids[0], ids: o.ids.slice(), name: o.name, side: o.side, cx: o.cx, cy: o.cy, len: o.len,
    stand: touch[oi].length > 0,
    ok: touch[oi].includes(main),
  }));
  const blockedDoors = openings.filter((o) => !o.ok).map((o) => o.id);
  return { ok: blockedDoors.length === 0, blockedDoors, grid: { x0: b.x0, y0: b.y0, w, h, cell, corner }, openings };
}

/**
 * Проверка проходимости комнаты: все проёмы достижимы друг из друга центром капсулы игрока.
 * Препятствия — фиксированный декор комнаты плюс extra (например, prop, выпавшие на спотах).
 * Базовая решётка (пол, створы) кэшируется по room.cells, решётка с декором — по сигнатуре декора,
 * результат — по сигнатуре extra. Результат нельзя мутировать.
 */
export function walkCheck(room: Room, propsById: PropLookup, extra?: readonly WalkProp[], opts: WalkOpts = {}): WalkResult {
  const cellM = opts.cellM && opts.cellM > 0 ? opts.cellM : 0.1;
  const ctx = staticOf(room, propsById, cellM, opts.radiusM ?? walkRadiusM(room));
  return checkWith(ctx, propsById, extra, cellM);
}

interface StaticCtx {
  b: Base;
  st: StaticGrid;
}

/** Базовая решётка комнаты + решётка с фиксированным декором (обе из кэша, если не менялись). */
function staticOf(room: Room, propsById: PropLookup, cellM: number, radiusM: number): StaticCtx {
  const b = baseOf(room, cellM, radiusM);
  const decor = solidsOf(room.decor, propsById, cellM);
  const dkey = decor.map((s) => s.key).join(';');
  let st = b.statics.get(dkey);
  if (!st) {
    const free = { c: b.free.c.slice(), m: b.free.m.slice() };
    for (const s of decor) stamp(b, free, s);
    st = { free, memo: new Map() };
    if (b.statics.size >= STATIC_CAP) b.statics.clear();
    b.statics.set(dkey, st);
  }
  return { b, st };
}

/** Результат для набора дополнительных prop поверх решётки с декором (мемоизирован). */
function checkWith({ b, st }: StaticCtx, propsById: PropLookup, extra: readonly WalkProp[] | undefined, cellM: number): WalkResult {
  const ex = extra && extra.length ? solidsOf(extra, propsById, cellM) : [];
  const ekey = ex.map((s) => s.key).join(';');
  let res = st.memo.get(ekey);
  if (!res) {
    let free = st.free;
    if (ex.length) {
      free = { c: free.c.slice(), m: free.m.slice() };
      for (const s of ex) stamp(b, free, s);
    }
    res = evaluate(b, free);
    if (st.memo.size >= MEMO_CAP) st.memo.clear();
    st.memo.set(ekey, res);
  }
  return res;
}

/** Подпись проблемы для человека: «двери «A» и «B» разделены мебелью», «проём «C» загорожен вплотную». */
export function walkMessage(r: WalkResult): string | null {
  if (r.ok) return null;
  const okNames = r.openings.filter((o) => o.ok).map((o) => o.name);
  const cut = r.openings.filter((o) => !o.ok && o.stand).map((o) => o.name);
  const shut = r.openings.filter((o) => !o.stand).map((o) => o.name);
  const parts: string[] = [];
  if (cut.length) {
    parts.push(okNames.length
      ? `двери ${okNames[0]} и ${cut.join(', ')} разделены мебелью`
      : `двери ${cut.join(' и ')} разделены мебелью`);
  }
  if (shut.length) parts.push(`${shut.length > 1 ? 'проёмы' : 'проём'} ${shut.join(', ')} загорожен${shut.length > 1 ? 'ы' : ''} вплотную`);
  return parts.join('; ');
}

// ───────────────────────── розыгрыш спотов (rollContent) ─────────────────────────

/** Группа в наполнении экземпляра; fallback — выпавший вариант перегораживал проход и подменён (§5.2). */
export type ContentGroup = InstanceContent['groups'][number] & { fallback?: true };

/** Сколько групп спотов подменено ради проходимости. */
export function countWalkFallbacks(content: readonly InstanceContent[]): number {
  let n = 0;
  for (const c of content) for (const g of c.groups) if ((g as ContentGroup).fallback) n++;
  return n;
}

/** Строка предупреждения прогона о подменах (null — подмен не было). */
export function walkWarning(content: readonly InstanceContent[]): string | null {
  const n = countWalkFallbacks(content);
  if (n === 0) return null;
  let groups = 0;
  for (const c of content) groups += c.groups.length;
  return `Проходимость: подменено вариантов спотов — ${n} из ${groups} (выпавший перегораживал проход между дверями; content[].groups[].fallback).`;
}

const propMaps = new WeakMap<readonly Prop[], Map<string, Prop>>();

/** id → Prop по массиву проекта (кэш; массив редактор может менять на месте — сверяем поштучно). */
function propMapOf(list: readonly Prop[]): Map<string, Prop> {
  const m = propMaps.get(list);
  if (m && m.size === list.length && list.every((x) => m.get(x.id) === x)) return m;
  const fresh = new Map(list.map((x) => [x.id, x] as const));
  propMaps.set(list, fresh);
  return fresh;
}

const hasPropAssign = (v: Variant): boolean => {
  for (const k in v.assign) if (v.assign[k].kind === 'prop') return true;
  return false;
};

/**
 * Подбор вариантов групп спотов одного экземпляра с учётом проходимости (§5.2 GENERATOR.md).
 * Без обращений к ГСЧ: выпавший вариант проверяется вместе с декором и вариантами предыдущих групп;
 * если он перегораживает проход — берётся следующий по убыванию веса из остальных (вес > 0, при равенстве —
 * по порядку), в крайнем случае — выпавший без напольных prop. Если проход перекрыт уже фиксированным
 * декором, подмен нет (это ошибка комнаты — её показывает редактор).
 */
export class WalkRoll {
  private props: Map<string, Prop> | null = null;
  /** решётка с декором — одна на экземпляр (проверка клеток комнаты — один раз) */
  private ctx: StaticCtx | null = null;
  private baseOk: boolean | null = null;
  private readonly placed: WalkProp[] = [];
  private readonly cellM: number;

  constructor(private readonly p: Project, private readonly room: Room) {
    this.cellM = p.settings.cellM > 0 ? p.settings.cellM : 0.1;
  }

  choose(g: SpotGroup, vi: number): { v: Variant; fallback: boolean; strip: boolean } {
    const rolled = g.variants[vi];
    if (!hasPropAssign(rolled)) return { v: rolled, fallback: false, strip: false };
    const props = this.lookup();
    const own = variantFloorProps(this.room, g, rolled, props);
    if (own.length === 0) return { v: rolled, fallback: false, strip: false };
    if (this.baseOk === null) this.baseOk = this.ok([]);
    if (!this.baseOk || this.ok(own)) {
      this.placed.push(...own);
      return { v: rolled, fallback: false, strip: false };
    }
    const order = g.variants.map((_, i) => i)
      .filter((i) => i !== vi && g.variants[i].weight > 0)
      .sort((a, b) => g.variants[b].weight - g.variants[a].weight || a - b);
    for (const i of order) {
      const alt = variantFloorProps(this.room, g, g.variants[i], props);
      if (alt.length === 0 || this.ok(alt)) {
        this.placed.push(...alt);
        return { v: g.variants[i], fallback: true, strip: false };
      }
    }
    return { v: rolled, fallback: true, strip: true };
  }

  /** Содержимое спота — напольный prop (при strip убирается). */
  blocks(a: Assign): boolean {
    if (a.kind !== 'prop') return false;
    const pr = this.lookup().get(a.id);
    return !!pr && !isFlatProp(pr);
  }

  private ok(extra: WalkProp[]): boolean {
    const props = this.lookup();
    if (!this.ctx) this.ctx = staticOf(this.room, props, this.cellM, PLAYER_RADIUS_M);
    return checkWith(this.ctx, props, this.placed.length ? [...this.placed, ...extra] : extra, this.cellM).ok;
  }

  private lookup(): Map<string, Prop> {
    if (!this.props) this.props = propMapOf(this.p.props);
    return this.props;
  }
}
