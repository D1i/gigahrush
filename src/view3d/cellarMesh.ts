// Земляной погреб (биом «Погреб»: узкие ходы, щели, комнатки; темно, пыль): оболочка куска — не стены болванки, а
// полость в чёрной осыпающейся земле. Полость задана функцией расстояния (SDF, < 0 — воздух, > 0 — земля), сетка — общий
// surface nets снежных ходов (./snowMesh.ts, surfaceNets) на мировой решётке 5 см. Без Babylon: на выходе — массивы
// вершин в координатах Babylon (X = x, Y = z, Z = −y плана); меш, материал, кэш и воркер — ./cellarView.ts.
//
// Коллайдеры — коробки стен и пол болванки (портальный рендер их только прячет), поэтому оболочка почти не заходит в
// проходимое: стены — по линии стены болванки, комья — наружу (в землю, 0…8.5 см), внутрь — не больше 1.8 см (в щели
// 0.4 м камера не должна влезать в землю). Полость куска:
//  • план — клетки комнаты (объединение прямоугольников) от пола до свода: свод 1.85 м в ходах и щелях (тег «ход»),
//    1.95 м в хабах и комнатках (своя высота комнаты Room.ceilM — она); угол стена — свод скруглён (низкая арка);
//  • рельеф: комья 0.4 / 0.13 / 0.07 м, карманы выпавших комьев, слоистость; свод — комья и провисания (в ходе не ниже
//    1.8 м — над перемычками крепи 1.78 м); пол — ровный (по нему ходят), на сантиметр ниже нуля; у подошвы стен —
//    осыпь крошек;
//  • открытый проём (связан, нераскрытый) — точное устье: прямоугольник ширины проёма (на 4 мм уже: его край на
//    плоскости — внутри маски портала) высотой до CEL_DOOR_H со скруглёнными верхними углами, вытянутый по нормали.
//    У проёма рельеф гаснет, и в 0.1 м от плоскости проёма полость — только устье, не зависящее от расстояния до
//    плоскости: кольцо вершин на плоскости одинаково у обоих соседей (шов не виден). Остальная полость к плоскости
//    проёма не подходит ближе 1.2 см;
//  • закрытый проём с дверью болванки (выход наверх 'stair', приход, дверь в снег 'snowdoor' — дверь cellar_low,
//    src/blockout/doors.ts) — ниша 3.5 см за линией стены во весь проём, вокруг наличника — только комья наружу, свод
//    над дверью поднят (альков): дверь видна целиком; без двери (тупик 'wall') — глухая стена;
//  • завал (RunConnector.collapsed) — куча земли от проёма в комнату (раскопка — меньше).
import type { DeadEndMode, RunConnector, RunExport, RunInstance, Side } from '../blockout/types';
import { isCellarTags } from '../locations/cellarSqueeze';
import { SNOWDOOR_CONN } from '../locations/storyDoors';
import { hashStr, surfaceNets, vnoise, type SnowMeshData } from './snowMesh';

/** Шаг решётки, м (делит полузазор 5 см: плоскость проёма — на узлах решётки). */
export const CEL_STEP = 0.05;
/** Свод: ходы и щели / хабы и комнатки, м. */
export const CEL_VAULT_PASS = 1.85;
export const CEL_VAULT_ROOM = 1.95;
/** Высота устья проёма, м (не выше проёма портала). */
export const CEL_DOOR_H = 1.8;
/** Устье уже проёма на столько с каждой стороны, м. */
export const CEL_INSET = 0.004;
/** Комья стен: наружу не дальше, внутрь не дальше, м. */
export const CEL_OUT = 0.085;
export const CEL_IN = 0.018;
/** Устье тянется в комнату за линию стены, м. */
const TUBE_IN = 0.25;
/** Ниша закрытой двери за линией стены, м. */
const NICHE = 0.035;
/** Полость (кроме устья) не ближе к плоскости открытого проёма, м. */
const KEEP = 0.012;
/** Средний сдвиг стен наружу (поле без рельефа — грубый проход сеточника). */
const MEAN = 0.022;

export type CellarDoorState = 'open' | 'closed' | 'collapsed';

/** Проём куска (мир, план, метры): середина на плоскости проёма (середина стены между соседями — граница кусков
 *  портального рендера), нормаль внутрь куска, полуширина. */
export interface CellarDoor {
  id: string;
  side: Side;
  x: number;
  y: number;
  nx: number;
  ny: number;
  half: number;
  state: CellarDoorState;
  /** открытый: высота устья, м (у обоих соседей одна) */
  top: number;
  /** закрытый / завал: высота двери болванки, м (ниша, свод над наличником); нет — глухая стена */
  slot?: number;
  /** завал раскопан на долю 0…1 */
  dug?: number;
}

export interface CellarRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CellarPieceSpec {
  /** клетки комнаты — прямоугольники плана, м; cell — сторона клетки */
  rects: CellarRect[];
  cell: number;
  /** габарит (план, м) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Babylon Y = floorY + z */
  floorY: number;
  /** полузазор: плоскость проёма — на столько за линией стены, м */
  pad: number;
  doors: CellarDoor[];
  /** высота свода, м */
  vault: number;
  seed: number;
}

/** Комната погреба (первый тег — «погреб», src/locations/cellarSqueeze.ts). */
export const isCellarRoom = (inst: Pick<RunInstance, 'roomTags'> | null | undefined): boolean => !!inst && isCellarTags(inst.roomTags);

const OUT: Record<Side, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

/** Клетки экземпляра ("y:x1-x2,x3", мировые) → прямоугольники (ряды, слитые по вертикали), клетки. */
export function cellRects(rows: readonly string[]): { x0: number; y0: number; x1: number; y1: number }[] {
  const byRow = new Map<number, [number, number][]>();
  for (const row of rows) {
    const i = row.indexOf(':');
    const y = Number(row.slice(0, i));
    if (!Number.isInteger(y)) continue;
    const runs: [number, number][] = [];
    const xs: number[] = [];
    for (const part of row.slice(i + 1).split(',')) {
      const m = /^(-?\d+)(?:-(-?\d+))?$/.exec(part.trim());
      if (!m) continue;
      const a = +m[1], b = m[2] !== undefined ? +m[2] : a;
      for (let x = Math.min(a, b); x <= Math.max(a, b); x++) xs.push(x);
    }
    xs.sort((a, b) => a - b);
    for (const x of xs) {
      const last = runs[runs.length - 1];
      if (last && x <= last[1] + 1) last[1] = Math.max(last[1], x);
      else runs.push([x, x]);
    }
    byRow.set(y, [...(byRow.get(y) ?? []), ...runs]);
  }
  const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const open = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  for (const y of [...byRow.keys()].sort((a, b) => a - b)) {
    const seen = new Set<string>();
    for (const [a, b] of byRow.get(y)!) {
      const k = `${a}:${b}`;
      seen.add(k);
      const r = open.get(k);
      if (r && r.y1 === y) r.y1 = y + 1;
      else {
        const n = { x0: a, y0: y, x1: b + 1, y1: y + 1 };
        open.set(k, n);
        out.push(n);
      }
    }
    for (const k of [...open.keys()]) if (!seen.has(k)) open.delete(k);
  }
  return out;
}

export interface CellarSpecOptions {
  /** высота дверей и стен болванки (BlockoutOptions), м */
  doorHeightM?: number;
  wallHeightM?: number;
  /** тупики болванки: 'wall' — глухая стена без двери; выход и приход — с дверью всегда */
  deadEnds?: DeadEndMode;
  /** нераскрытые двери (RunConnector.cut) — проём в темноту (PieceCacheOptions.openCut); иначе — дверная панель */
  openCut?: boolean;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Спецификация куска по экземпляру прогона. partner — экземпляр за связью (высота устья — по меткам обеих сторон). */
export function cellarSpecOf(inst: RunInstance, cellM: number, opts: CellarSpecOptions = {}, gapCells = 1, partner?: (k: RunConnector) => { inst: RunInstance; k: RunConnector } | null): CellarPieceSpec {
  const wallH = num(opts.wallHeightM) > 0 ? num(opts.wallHeightM) : 2.5;
  const doorH = Math.min(num(opts.doorHeightM) > 0 ? num(opts.doorHeightM) : 2.1, wallH);
  const ceilOf = (i: RunInstance) => (num(i.ceilM) > 0 ? num(i.ceilM) : wallH);
  const openOf = (k: RunConnector | undefined) => (k && num(k.openH) > 0 ? num(k.openH) : doorH);
  const pad = (gapCells * cellM) / 2;
  const doors: CellarDoor[] = [];
  for (const c of inst.connectors) {
    if (c.len < 1) continue;
    const [x1, y1, x2, y2] = c.line;
    const [ox, oy] = OUT[c.side];
    let state: CellarDoorState;
    let slot: number | undefined;
    if (c.collapsed) state = 'collapsed';
    else if (c.linkedTo || (c.cut && opts.openCut)) state = 'open';
    else state = 'closed';
    // дверь болванки у закрытой метки: выход, приход — всегда; тупик — если тупики не глухие; срезанная — панель
    if (state !== 'open' && (c.exit || c.arrival || c.cut || opts.deadEnds !== 'wall')) slot = Math.min(openOf(c), ceilOf(inst));
    // дверь в снег (src/view3d/storyWalk.ts): без слота болванки — своя низкая дверь 1.8 м и снег вровень со стеной
    else if (state !== 'open' && c.id === SNOWDOOR_CONN) slot = Math.min(1.8, ceilOf(inst));
    let top = Math.min(CEL_DOOR_H, openOf(c), ceilOf(inst));
    const p = state === 'open' ? partner?.(c) : null;
    if (p) top = Math.min(top, openOf(p.k), ceilOf(p.inst));
    doors.push({
      id: c.id,
      side: c.side,
      x: ((x1 + x2) / 2) * cellM + ox * pad,
      y: ((y1 + y2) / 2) * cellM + oy * pad,
      nx: -ox,
      ny: -oy,
      half: (c.len * cellM) / 2,
      state,
      top,
      ...(slot !== undefined ? { slot } : {}),
      ...(c.collapsed && c.dug ? { dug: c.dug } : {}),
    });
  }
  const rects = cellRects(inst.cells).map((r) => ({ x0: r.x0 * cellM, y0: r.y0 * cellM, x1: r.x1 * cellM, y1: r.y1 * cellM }));
  const b = rects.reduce((a, r) => ({ x0: Math.min(a.x0, r.x0), y0: Math.min(a.y0, r.y0), x1: Math.max(a.x1, r.x1), y1: Math.max(a.y1, r.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const tags = inst.roomTags;
  const ceil = num(inst.ceilM);
  return {
    rects,
    cell: cellM,
    ...b,
    floorY: 0,
    pad,
    doors,
    vault: ceil >= 1.7 && ceil <= 2.4 ? ceil : tags.includes('ход') ? CEL_VAULT_PASS : CEL_VAULT_ROOM,
    seed: hashStr(inst.id),
  };
}

/** Спецификация куска экземпляра id прогона (null — не погреб) и ключ кэша (экземпляр, состояния проёмов, место). */
export function cellarSpecFor(run: RunExport, id: string, opts: CellarSpecOptions = {}): { spec: CellarPieceSpec; key: string } | null {
  const inst = run.instances.find((i) => i.id === id);
  if (!inst || !isCellarRoom(inst) || !inst.cells?.length) return null;
  const gap = typeof run.settings?.gap === 'number' ? run.settings.gap : 1;
  const partner = (k: RunConnector) => {
    if (!k.linkedTo) return null;
    const n = run.instances.find((i) => i.id === k.linkedTo!.inst);
    const kn = n?.connectors.find((x) => x.id === k.linkedTo!.connector);
    return n && kn ? { inst: n, k: kn } : null;
  };
  const spec = cellarSpecOf(inst, run.cellM > 0 ? run.cellM : 0.1, opts, gap, partner);
  const doors = spec.doors.map((d) => `${d.state[0]}${d.top.toFixed(3)}${d.slot !== undefined ? 's' + d.slot.toFixed(3) : ''}${d.dug ? 'd' + d.dug : ''}`).join(',');
  const key = `${id}|${doors}|${spec.x0},${spec.y0},${spec.vault},${inst.cells.join(';')}`;
  return { spec, key };
}

// ───────────────────────── поле ─────────────────────────

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/** SDF устья в сечении: lat — расстояние от оси вбок (≥ 0), z — высота над полом; hw — полуширина, top — высота. */
export function cellarProfile(lat: number, z: number, hw: number, top: number): number {
  const rc = Math.min(0.14, hw * 0.5);
  const qx = lat - (hw - rc), qz = z - (top - rc);
  const side = qx > 0 && qz > 0 ? Math.hypot(qx, qz) - rc : Math.max(lat - hw, z - top);
  return Math.max(side, -z);
}

export interface CellarField {
  /** SDF: < 0 воздух; noise — с рельефом */
  f(x: number, y: number, z: number, noise?: boolean): number;
  /** расстояние до стены плана комнаты (< 0 — внутри клеток), м */
  plan(x: number, y: number): number;
  /** у плоскости открытого проёма: вес 0…1 (1 — на плоскости, 0 — дальше 0.12 м), в out — нормаль устья к воздуху (план)
   *  и [3] — насколько открыто устье в 0.1 м по ней; по точному профилю — у обоих соседей одинаково (без шва в свете) */
  mouth(x: number, y: number, z: number, out: Float64Array): number;
  zMin: number;
  zMax: number;
}

interface DoorRt {
  d: CellarDoor;
  hw: number;
  /** плоскость проёма — на стороне габарита: прижим и предел комьев — по всей стороне */
  full: boolean;
}

/** Поле полости куска (план, метры; z — над полом). */
export function cellarField(spec: CellarPieceSpec): CellarField {
  const { cell, pad, vault: top } = spec;
  const S = spec.seed;
  // клетки плана: занятость и граница (отрезки между клеткой комнаты и не комнатой)
  const ox = Math.round(spec.x0 / cell), oy = Math.round(spec.y0 / cell);
  const W = Math.max(1, Math.round((spec.x1 - spec.x0) / cell)), H = Math.max(1, Math.round((spec.y1 - spec.y0) / cell));
  const occ = new Uint8Array(W * H);
  for (const r of spec.rects) {
    for (let j = Math.round(r.y0 / cell) - oy; j < Math.round(r.y1 / cell) - oy; j++) {
      for (let i = Math.round(r.x0 / cell) - ox; i < Math.round(r.x1 / cell) - ox; i++) if (i >= 0 && j >= 0 && i < W && j < H) occ[j * W + i] = 1;
    }
  }
  const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < W && j < H ? occ[j * W + i] : 0);
  // горизонтальные отрезки (y = const): [y, x0, x1]; вертикальные (x = const): [x, y0, y1]
  const hs: number[] = [], vs: number[] = [];
  for (let j = 0; j <= H; j++) {
    let s = -1;
    for (let i = 0; i <= W; i++) {
      const b = i < W && at(i, j - 1) !== at(i, j);
      if (b && s < 0) s = i;
      if (!b && s >= 0) {
        hs.push((oy + j) * cell, (ox + s) * cell, (ox + i) * cell);
        s = -1;
      }
    }
  }
  for (let i = 0; i <= W; i++) {
    let s = -1;
    for (let j = 0; j <= H; j++) {
      const b = j < H && at(i - 1, j) !== at(i, j);
      if (b && s < 0) s = j;
      if (!b && s >= 0) {
        vs.push((ox + i) * cell, (oy + s) * cell, (oy + j) * cell);
        s = -1;
      }
    }
  }
  const plan = (x: number, y: number): number => {
    let d2 = Infinity;
    for (let k = 0; k < hs.length; k += 3) {
      const dx = Math.max(hs[k + 1] - x, 0, x - hs[k + 2]), dy = y - hs[k];
      const q = dx * dx + dy * dy;
      if (q < d2) d2 = q;
    }
    for (let k = 0; k < vs.length; k += 3) {
      const dy = Math.max(vs[k + 1] - y, 0, y - vs[k + 2]), dx = x - vs[k];
      const q = dx * dx + dy * dy;
      if (q < d2) d2 = q;
    }
    const d = Math.sqrt(d2);
    return at(Math.floor(x / cell + 1e-9) - ox, Math.floor(y / cell + 1e-9) - oy) ? -d : d;
  };

  const opens: DoorRt[] = [];
  const slots: DoorRt[] = [];
  const heaps: DoorRt[] = [];
  for (const d of spec.doors) {
    const edge = d.side === 'W' ? spec.x0 - pad : d.side === 'E' ? spec.x1 + pad : d.side === 'N' ? spec.y0 - pad : spec.y1 + pad;
    const plane = d.side === 'W' || d.side === 'E' ? d.x : d.y;
    const rt: DoorRt = { d, hw: d.half - CEL_INSET, full: Math.abs(edge - plane) < 1e-6 };
    if (d.state === 'open') opens.push(rt);
    else if (d.slot !== undefined) slots.push(rt);
    if (d.state === 'collapsed') heaps.push(rt);
  }
  const R = top < 1.9 ? 0.15 : 0.22;
  const zMax = Math.max(top + 0.12, ...slots.map((s) => (s.d.slot ?? 0) + 0.2)) + 0.06;

  const f = (x: number, y: number, z: number, noise = true): number => {
    const dp = plan(x, y);
    // проёмы: гашение рельефа у устьев, предел комьев к плоскости, прижим, устья
    let fade = 1, cap = Infinity, keep = -Infinity, tube = Infinity;
    for (const o of opens) {
      const d = o.d;
      const dx = x - d.x, dy = y - d.y;
      const al = dx * d.nx + dy * d.ny;
      const la = Math.abs(-dx * d.ny + dy * d.nx);
      const dm = Math.hypot(Math.max(0, la - d.half), Math.max(0, al - pad));
      if (dm < 0.3) fade = Math.min(fade, sstep(0.1, 0.3, dm));
      const ext = o.full ? 0 : Math.max(0, la - d.half - 0.4) * 3;
      cap = Math.min(cap, al + Math.max(dp, 0) - KEEP - 0.002 + ext);
      keep = Math.max(keep, KEEP - al - ext);
      if (al < pad + TUBE_IN + 0.1) tube = Math.min(tube, Math.max(cellarProfile(la, z, o.hw, d.top), al - pad - TUBE_IN));
    }
    // свод и стены (скруглённый угол радиуса R)
    const qx = dp + R, qz = z - top + R;
    const g = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - R;
    let wv: number, floor: number;
    let n1 = 0, n2 = 0, n3 = 0;
    // рельеф — только у поверхности (у стен и свода, у пола, у альковов дверей)
    let near = Math.abs(g) < 0.16 || z < 0.2;
    if (!near) for (const s of slots) if (Math.abs((x - s.d.x) * s.d.nx + (y - s.d.y) * s.d.ny) < pad + 0.8 && Math.abs(-(x - s.d.x) * s.d.ny + (y - s.d.y) * s.d.nx) < s.d.half + 0.8) near = true;
    const rough = noise && near;
    if (!rough) {
      wv = g - MEAN * fade;
      floor = -z - 0.006 * fade;
    } else {
      n1 = vnoise(x * 2.6, y * 2.6, z * 2.6, S);
      n2 = vnoise(x * 7.5, y * 7.5, z * 7.5, S + 7);
      n3 = vnoise(x * 15, y * 15, z * 15, S + 11);
      const pk = vnoise(x * 1.7, y * 1.7, z * 1.7, S + 17);
      const lay = Math.sin(z * 26 + vnoise(x * 1.3, y * 1.3, z * 0.6, S + 13) * 2.5);
      // стены: комья наружу, карманы выпавших комьев, слои; внутрь — не дальше CEL_IN
      let dw = 0.022 + 0.034 * n1 + 0.016 * n2 + 0.007 * n3 + 0.004 * lay + 0.1 * Math.max(0, pk - 0.35);
      dw += 0.02 * vnoise(x * 1.1, y * 1.1, z * 1.1, S + 3);
      dw = Math.min(CEL_OUT, Math.max(-CEL_IN, dw));
      // свод: комья и провисания
      let dv = 0.035 + 0.03 * n1 + 0.014 * n2 + 0.006 * n3 - 0.12 * Math.max(0, -pk - 0.3);
      dv = Math.min(0.1, Math.max(-0.05, dv));
      let D = dw + (dv - dw) * sstep(top - 0.5, top - 0.12, z);
      // провисания свода не заходят на стены: ниже угла свода — внутрь не дальше CEL_IN
      D = Math.max(D, -CEL_IN - (0.05 - CEL_IN) * sstep(top - 0.25, top - 0.08, z));
      // у стороны с открытым проёмом комья не доходят до его плоскости
      if (D > cap - 0.015) D = smin(D, cap, 0.015);
      D *= fade;
      // у двери болванки — только наружу (наличник не тонет в земле)
      for (const s of slots) {
        const d = s.d;
        const dx = x - d.x, dy = y - d.y;
        const al = dx * d.nx + dy * d.ny;
        const la = Math.abs(-dx * d.ny + dy * d.nx);
        const dfr = Math.hypot(Math.max(0, la - d.half - 0.12), Math.max(0, z - (d.slot ?? 0) - 0.12), Math.max(0, al - pad - 0.06));
        if (dfr < 0.3) D += (Math.max(D, 0.004) - D) * (1 - sstep(0.08, 0.3, dfr));
      }
      wv = g - D;
      floor = -z - (0.006 + 0.005 * n2) * fade;
    }
    // закрытые двери болванки: альков над наличником и ниша за полотном
    for (const s of slots) {
      const d = s.d;
      const dx = x - d.x, dy = y - d.y;
      const al = dx * d.nx + dy * d.ny;
      const la = Math.abs(-dx * d.ny + dy * d.nx);
      if (al > pad + 0.8 || la > d.half + 0.8) continue;
      const h = d.slot ?? 0;
      // альков: комья только наружу (свод над наличником и стена у него)
      const lump = rough ? Math.max(0, 0.022 + 0.026 * n1 + 0.012 * n2 + 0.006 * n3) : MEAN;
      const alc = Math.max(la - d.half - 0.2, pad - al, al - pad - 0.45, z - h - 0.16) - lump;
      wv = smin(wv, alc, 0.1);
      wv = Math.min(wv, Math.max(la - d.half, pad - NICHE - al, al - pad - 0.1, z - h));
    }
    let v = Math.max(wv, floor);
    // осыпь у подошвы стен: крошки земли (e — расстояние от стены с комьями; у пола поле стен — расстояние до неё)
    if (rough && z < 0.2 && fade > 0) {
      const e = -wv;
      if (e < 0.22) {
        const r0 = (0.025 + 0.1 * Math.max(0, vnoise(x * 3.4, y * 3.4, 0.5, S + 41)) + 0.015 * n3) * fade;
        // комья осыпи ~10 см
        const cf = Math.hypot(Math.max(e, 0), z * 1.3) - r0 - (0.012 * n2 + 0.02 * vnoise(x * 10, y * 10, z * 10, S + 43)) * fade;
        v = Math.max(v, -cf);
      }
    }
    // завалы: проём засыпан вровень со стеной, земля оползает в комнату (кучу перед ним ставит ./cellarWalk.ts)
    for (const o of heaps) {
      const d = o.d;
      const dx = x - d.x, dy = y - d.y;
      const al = dx * d.nx + dy * d.ny - pad;
      const la = Math.abs(-dx * d.ny + dy * d.nx);
      if (al > 0.45 || la > d.half + 0.5) continue;
      const s = 1 - 0.6 * clamp01(d.dug ?? 0);
      const t = clamp01(z / top);
      const w = 1 - sstep(d.half, d.half + 0.35, la);
      if (w <= 0) continue;
      let depth = 0.03 + 0.24 * s * (1 - t) * (1 - t);
      if (noise) depth += 0.03 * vnoise(x * 6, y * 6, z * 6, S + 29) + 0.012 * vnoise(x * 14, y * 14, z * 14, S + 31);
      v = Math.max(v, (depth * w - al) * 0.8);
    }
    // не ближе KEEP к плоскостям открытых проёмов, кроме устья
    if (keep > v) v = keep;
    return tube < v ? tube : v;
  };

  const mouth = (x: number, y: number, z: number, out: Float64Array): number => {
    for (const o of opens) {
      const d = o.d;
      const dx = x - d.x, dy = y - d.y;
      const al = dx * d.nx + dy * d.ny;
      const ls = -dx * d.ny + dy * d.nx;
      const la = Math.abs(ls);
      if (Math.abs(al) > 0.12 || la > d.half + 0.08) continue;
      const e = 0.002;
      const gl = (cellarProfile(la + e, z, o.hw, d.top) - cellarProfile(Math.max(0, la - e), z, o.hw, d.top)) / (la + e - Math.max(0, la - e));
      const gz = (cellarProfile(la, z + e, o.hw, d.top) - cellarProfile(la, z - e, o.hw, d.top)) / (2 * e);
      // к воздуху — против градиента; вбок — по (−ny, nx) со знаком стороны
      const sg = ls < 0 ? -1 : 1;
      let nx = gl * sg * d.ny, ny = -gl * sg * d.nx, nz = -gz;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      out[0] = nx;
      out[1] = ny;
      out[2] = nz;
      const qx = x + nx * 0.1 - d.x, qy = y + ny * 0.1 - d.y;
      out[3] = -cellarProfile(Math.abs(-qx * d.ny + qy * d.nx), z + nz * 0.1, o.hw, d.top);
      return 1 - sstep(0.03, 0.12, Math.abs(al));
    }
    return 0;
  };

  return { f, plan, mouth, zMin: -0.1, zMax };
}

/**
 * Луч из воздуха полости в землю (руки на стене ложатся на бугры — ./cellarHands.ts): план, метры (z — над полом),
 * (dx, dy, dz) — единичный. Расстояние до земли (поле ≥ 0) или null: начало в земле или не дошёл за max. Шаг — по
 * величине поля (рельеф пологий — оно близко к расстоянию), не меньше 3 мм; у границы — делением пополам.
 */
export function cellarRay(F: CellarField, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number | null {
  let t = 0;
  let v = F.f(ox, oy, oz);
  if (v >= 0) return null;
  for (let i = 0; i < 48 && t < max; i++) {
    const t1 = Math.min(max, t + Math.max(0.003, -v * 0.6));
    const v1 = F.f(ox + dx * t1, oy + dy * t1, oz + dz * t1);
    if (v1 >= 0) {
      let a = t, b = t1;
      for (let k = 0; k < 6; k++) {
        const m = (a + b) / 2;
        if (F.f(ox + dx * m, oy + dy * m, oz + dz * m) >= 0) b = m;
        else a = m;
      }
      return (a + b) / 2;
    }
    t = t1;
    v = v1;
  }
  return null;
}

/** Меши оболочек на сцене → их спецификации (меш строит ./cellarView.ts; лучи рук в землю — ./cellarWalk.ts). */
const shellSpecs = new WeakMap<object, CellarPieceSpec>();
export const markCellarShell = (mesh: object, spec: CellarPieceSpec): void => void shellSpecs.set(mesh, spec);
export const cellarShellSpec = (mesh: object): CellarPieceSpec | null => shellSpecs.get(mesh) ?? null;

// ───────────────────────── сетка ─────────────────────────

/** чёрная земля #1d1712…#2a2119 — под фонарём (один источник, туман) ярче в SOIL_GAIN раз, иначе не видно комьев */
const SOIL_GAIN = 2.0;
const C0 = [(0x1d / 255) * SOIL_GAIN, (0x17 / 255) * SOIL_GAIN, (0x12 / 255) * SOIL_GAIN];
const C1 = [(0x2a / 255) * SOIL_GAIN, (0x21 / 255) * SOIL_GAIN, (0x19 / 255) * SOIL_GAIN];
/** глина / охра прожилок */
const CLAY = [0x6e / 255, 0x50 / 255, 0x30 / 255];
/** средняя яркость текстуры земли (./cellarView.ts) — цвета вершин поделены на неё */
export const SOIL_TEX_MEAN = 0.8;

/**
 * Сетка полости куска (общий surface nets, ./snowMesh.ts). Решётка — мировая, шаг step (кратен полузазору: плоскости
 * проёмов — на узлах); по сторонам с открытыми проёмами — на шаг за плоскость (вершины за ней прижимаются к ней), по
 * остальным — с запасом под комья. Цвет: чёрная земля (#1d1712…#2a2119), к полу темнее (сырость), впадины темнее,
 * редкие прожилки глины; поделён на среднюю яркость текстуры земли.
 */
export function buildCellarMesh(spec: CellarPieceSpec, step = CEL_STEP): SnowMeshData {
  const F = cellarField(spec);
  const M = CEL_OUT + 2 * step;
  const ext = { W: M, E: M, N: M, S: M };
  const lim = { W: 10, E: 10, N: 10, S: 10 };
  for (const d of spec.doors) {
    if (d.state !== 'open') continue;
    const edge = d.side === 'W' ? spec.x0 - spec.pad : d.side === 'E' ? spec.x1 + spec.pad : d.side === 'N' ? spec.y0 - spec.pad : spec.y1 + spec.pad;
    const plane = d.side === 'W' || d.side === 'E' ? d.x : d.y;
    if (Math.abs(edge - plane) > 1e-6) continue;
    ext[d.side] = Math.max(spec.pad + step, 0);
    lim[d.side] = spec.pad;
  }
  // цвет — по мировым координатам с общим зерном: у соседей по проёму одинаков на шве
  const SC = 0x2c311a;
  const k = 1 / SOIL_TEX_MEAN;
  const mo = new Float64Array(4);
  return surfaceNets(
    {
      f: F.f,
      x0: spec.x0 - ext.W,
      y0: spec.y0 - ext.N,
      x1: spec.x1 + ext.E,
      y1: spec.y1 + ext.S,
      z0: F.zMin,
      z1: F.zMax,
      cx0: spec.x0 - lim.W,
      cy0: spec.y0 - lim.N,
      cx1: spec.x1 + lim.E,
      cy1: spec.y1 + lim.S,
      floorY: spec.floorY,
      uvM: 0.5,
      // у плоскости открытого проёма нормаль — по точному профилю устья (у соседей одинакова: шов не виден в свете)
      normal(x, y, z, n) {
        const w = F.mouth(x, y, z, mo);
        if (w <= 0) return;
        const nx = n[0] + (mo[0] - n[0]) * w, ny = n[1] + (mo[1] - n[1]) * w, nz = n[2] + (mo[2] - n[2]) * w;
        const l = Math.hypot(nx, ny, nz) || 1;
        n[0] = nx / l;
        n[1] = ny / l;
        n[2] = nz / l;
      },
      color(x, y, z, gx, gy, gz, at, out, o) {
        // впадины темнее: насколько глубоко в воздух уходит поле вдоль нормали (у проёма — по профилю устья)
        let probe = -at(x + gx * 0.1, y + gy * 0.1, z + gz * 0.1);
        const wm = F.mouth(x, y, z, mo);
        if (wm > 0) probe += (mo[3] - probe) * wm;
        const ao = Math.min(1, Math.max(0.4, 0.4 + (probe / 0.1) * 0.6));
        const t = 0.5 + 0.5 * vnoise(x * 1.3, y * 1.3, z * 1.3, SC + 101);
        // сырые пятна — темнее, к полу — темнее
        const wet = 1 - 0.22 * clamp01(vnoise(x * 0.9, y * 0.9, z * 0.9, SC + 107) * 2 - 0.2);
        const low = 0.74 + 0.26 * clamp01(z / 0.9);
        let r = C0[0] + (C1[0] - C0[0]) * t, g = C0[1] + (C1[1] - C0[1]) * t, b = C0[2] + (C1[2] - C0[2]) * t;
        // прожилки глины: редкие тонкие слои линзами (по стенам)
        const tz = z * 5.5 + vnoise(x * 0.9, y * 0.9, z * 0.4, SC + 131) * 1.2;
        const li = Math.floor(tz);
        if (((Math.imul(li + 977, 2654435761) ^ SC) >>> 0) % 100 < 14) {
          const lens = clamp01(vnoise(x * 2.2, y * 2.2, li * 1.7, SC + 137) * 2.2 + 0.1);
          const w = (1 - sstep(0.025, 0.09, Math.abs(tz - li - 0.5))) * (1 - Math.abs(gz)) * 0.55 * lens;
          r += (CLAY[0] - r) * w;
          g += (CLAY[1] - g) * w;
          b += (CLAY[2] - b) * w;
        }
        const m = ao * wet * low * k;
        out[o] = Math.min(1, r * m);
        out[o + 1] = Math.min(1, g * m);
        out[o + 2] = Math.min(1, b * m);
        out[o + 3] = 1;
      },
    },
    step,
    true,
  );
}
