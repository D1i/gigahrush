// Лестницы с перепадом высоты и высота комнат в кусках портального рендера. Без зависимостей от приложения и движка.
//
// Ядро (core.ts) строит всё на одной отметке: пол 0, стены −плита…стена+плита. Высоту даёт кусок комнаты (pieces.ts):
//  • комната на высоте z (RunInstance.z — за лестницами мир выше/ниже) — весь кусок поднимается на z;
//  • комната с лестницей (RunInstance.stair) — зал на два уровня: стены и потолок выше на перепад R (самая высокая
//    площадка), проём метки с подъёмом dz (RunConnector.dz) — на dz выше: под его половиной — стена, перемычка — выше;
//    марши (ступени), площадки (массив до их пола), перила у обрывов (бок марша, край площадки) — StairGeo.
// Опора на марше — «линия носков»: через передние рёбра ступеней, от пола за проступь до первой ступени до верха; по ней
// идёт невидимый пандус-коллайдер и опора игрока (src/view3d/stairWalk.ts). Ступени видимые, но без коллизий.
//
// Координаты: план (x вправо, y вниз), z вверх; меши — Babylon (X = x, Y = z, Z = −y), как в babylon.ts.
import type { BlockoutModel, DeadEnd, DoorSlot, PropBox, Rect, RunConnector, RunInstance, Side, Solid, StairGeo, Surface, WallFace } from './types';

/** Перила: высота поручня над полом, отступ от края внутрь, шаг стоек, м. */
const RAIL_H = 0.9;
const RAIL_IN = 0.05;
const POST_STEP = 0.5;
/** Коллайдер перил — тоньше и выше поручня (не перешагнуть), м. */
const RAIL_COL_H = 1.05;
/** Обрыв, у которого ставятся перила, м. */
const DROP = 0.3;

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const overlap = (a: Rect, b: Rect) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-6 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1e-6;
const inRects = (rs: readonly Rect[], x: number, y: number) => rs.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1);

/** Перепад лестницы экземпляра (самая высокая площадка / верх марша над низом комнаты), м. */
export function stairRiseOf(inst: Pick<RunInstance, 'stair'>): number {
  const s = inst.stair;
  if (!s) return 0;
  let z = 0;
  for (const f of s.flights ?? []) z = Math.max(z, num(f.z0), num(f.z1));
  for (const p of s.pads ?? []) z = Math.max(z, num(p.z));
  return z;
}

// ───────────────────────── марш: линия носков ─────────────────────────

type Flight = StairGeo['flights'][number];

/** Марш в осях «вдоль подъёма» s (от нижнего края, м), «поперёк» a (м); длина L, ширина W, проступь t, подъём ступени r. */
function axes(f: Flight, x: number, y: number): { s: number; a: number; L: number; W: number; t: number; r: number } {
  const { rect: q, up } = f;
  const vert = up === 'N' || up === 'S';
  const L = vert ? q.y1 - q.y0 : q.x1 - q.x0;
  const W = vert ? q.x1 - q.x0 : q.y1 - q.y0;
  const s = up === 'N' ? q.y1 - y : up === 'S' ? y - q.y0 : up === 'E' ? x - q.x0 : q.x1 - x;
  const a = vert ? x - q.x0 : y - q.y0;
  return { s, a, L, W, t: L / f.steps, r: (f.z1 - f.z0) / f.steps };
}

/** Точка плана марша по (s, a). */
function at(f: Flight, s: number, a: number): [number, number] {
  const q = f.rect;
  switch (f.up) {
    case 'N': return [q.x0 + a, q.y1 - s];
    case 'S': return [q.x0 + a, q.y0 + s];
    case 'E': return [q.x0 + s, q.y0 + a];
    case 'W': return [q.x1 - s, q.y0 + a];
  }
}

/** Высота линии носков в s (м от нижнего края): от z0 за проступь до марша до z1 у последней ступени. */
function noseZ(f: Flight, s: number, t: number, r: number): number {
  return Math.min(f.z1, Math.max(f.z0, f.z0 + ((s + t) * r) / t));
}

/** Пол лестниц в точке плана: высота (абс., м) и марш ли это (на марше — опора по линии носков, на площадке — обычный
 *  пол); null — не над маршем (с проступью перед ним) и не над площадкой. */
export function stairFloorAt(geos: readonly StairGeo[] | undefined, x: number, y: number): { z: number; flight: boolean } | null {
  let best: { z: number; flight: boolean } | null = null;
  for (const g of geos ?? []) {
    for (const p of g.pads) if (x > p.rect.x0 && x < p.rect.x1 && y > p.rect.y0 && y < p.rect.y1 && (!best || p.z > best.z)) best = { z: p.z, flight: false };
    for (const f of g.flights) {
      const { s, a, L, W, t, r } = axes(f, x, y);
      if (a <= 0 || a >= W || s < -t || s > L) continue;
      const z = noseZ(f, s, t, r);
      if (!best || z > best.z + 1e-9 || (z > best.z - 1e-9 && !best.flight)) best = { z, flight: true };
    }
  }
  return best;
}

// ───────────────────────── кусок: высота и лестница ─────────────────────────

/**
 * Кусок комнаты на своей высоте: всё — на z экземпляра выше; у комнаты с лестницей — стены и потолок выше на перепад,
 * проёмы меток с dz — на dz выше (под половиной проёма — стена), двери и тупики этих меток — на своей отметке,
 * предметы — на полу площадки под ними, лестница (StairGeo) с перилами у обрывов. Своя высота потолка (RunInstance.ceilM)
 * — стены, потолок и подвесные предметы ещё выше (на ceilM − wallHeightM). Высота проёма по метке (RunConnector.openH,
 * TAG_OPEN_H): верх проёма — по метке, не выше потолков обеих комнат (сосед — other); перемычка своей половины — от верха
 * проёма до своего потолка, проём не ниже потолка — перемычки нет, половину закрывает плита потолка. Вход не мутируется;
 * без высоты, лестницы, своего потолка и высоких проёмов — тот же объект.
 */
export function liftPiece(piece: BlockoutModel, inst: RunInstance | undefined, other?: (id: string) => RunInstance | undefined): BlockoutModel {
  if (!inst) return piece;
  const B = num(inst.z);
  const R = stairRiseOf(inst);
  const wallH = num(piece.options?.wallHeightM) > 0 ? num(piece.options?.wallHeightM) : 2.5;
  const doorH = Math.min(piece.options?.doorHeightM ?? wallH, wallH);
  /** высота потолка экземпляра над его низом (без подъёма лестницы), м */
  const ceilOf = (i: RunInstance) => (num(i.ceilM) > 0 ? num(i.ceilM) : wallH);
  // подъём потолка сверх стен болванки (своя высота комнаты)
  const X = r6(ceilOf(inst) - wallH);
  const tall = (inst.connectors ?? []).some((k) => num(k.openH) > 0);
  if (!B && !R && !X && !tall) return piece;
  const id = inst.id;
  const c = piece.cellM > 0 ? piece.cellM : 0.1;
  const slab = Math.max(0, piece.options?.slabM ?? 0);
  const dzOf = new Map((inst.connectors ?? []).map((k) => [k.id, num(k.dz)] as const));
  const conns = new Map((inst.connectors ?? []).map((k) => [k.id, k] as const));
  /** потолок комнаты, абс. м */
  const CA = B + R + ceilOf(inst);
  const openOf = (k: RunConnector | undefined) => (k && num(k.openH) > 0 ? num(k.openH) : doorH);
  /** верх проёма метки своей стороны, м от пола проёма: по метке, не выше своего потолка */
  const ownTop = (k: RunConnector | undefined) => Math.min(openOf(k), CA - B - num(k?.dz));
  /** проём не обычный: высокая метка или свой потолок */
  const ownCustom = (k: RunConnector | undefined) => num(k?.openH) > 0 || num(inst.ceilM) > 0;
  // проёмы комнаты: подъём пола у метки, верх проёма (м от его пола) — по меткам и потолкам обеих сторон
  type Hole = { rect: Rect; dz: number; top: number; custom: boolean; conn: string };
  const ops: Hole[] = piece.openings.map((o) => {
    const mine = o.a.inst === id ? o.a : o.b, them = o.a.inst === id ? o.b : o.a;
    const k = conns.get(mine.connector);
    const dz = dzOf.get(mine.connector) ?? 0;
    let top = ownTop(k), custom = ownCustom(k);
    const n = them.inst !== id ? other?.(them.inst) : undefined;
    if (n) {
      const kn = (n.connectors ?? []).find((x) => x.id === them.connector);
      top = Math.min(top, openOf(kn), num(n.z) + stairRiseOf(n) + ceilOf(n) - (B + dz));
      custom ||= num(kn?.openH) > 0 || num(n.ceilM) > 0;
    }
    return { rect: o.rect, dz, top, custom, conn: mine.connector };
  });
  /** своя метка у прямоугольника, где проёма нет (проём в темноту нераскрытой двери): вдоль её линии, вплотную */
  const zone = (r: Rect): RunConnector | undefined => {
    let best: RunConnector | undefined, bd = Infinity;
    for (const k of inst.connectors ?? []) {
      const [x1, y1, x2, y2] = k.line.map((v) => v * c);
      const horiz = k.side === 'N' || k.side === 'S';
      const along = horiz
        ? Math.min(Math.max(x1, x2), r.x1) - Math.max(Math.min(x1, x2), r.x0)
        : Math.min(Math.max(y1, y2), r.y1) - Math.max(Math.min(y1, y2), r.y0);
      if (along <= 1e-6) continue;
      const d = horiz ? Math.max(0, r.y0 - y1, y1 - r.y1) : Math.max(0, r.x0 - x1, x1 - r.x1);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return bd <= 0.3 ? best : undefined;
  };
  /** проём у прямоугольника; null — обычный (подъём dzAt, верх doorHeightM — как раньше) */
  const holeAt = (r: Rect): Hole | null => {
    const o = ops.find((h) => overlap(h.rect, r));
    if (o) return o;
    const k = zone(r);
    return k && ownCustom(k) ? { rect: r, dz: num(k.dz), top: ownTop(k), custom: true, conn: k.id } : null;
  };
  const dzAt = (r: Rect): number => ops.find((o) => overlap(o.rect, r))?.dz ?? 0;
  const holeAtLine = (l: [number, number, number, number]): Hole | null => {
    const x = (l[0] + l[2]) / 2, y = (l[1] + l[3]) / 2, e = 1e-3;
    const o = ops.find((h) => x > h.rect.x0 - e && x < h.rect.x1 + e && y > h.rect.y0 - e && y < h.rect.y1 + e);
    if (o) return o;
    return holeAt({ x0: Math.min(l[0], l[2]) - e, y0: Math.min(l[1], l[3]) - e, x1: Math.max(l[0], l[2]) + e, y1: Math.max(l[1], l[3]) + e });
  };
  /** у половины проёма своя перемычка: верх проёма ниже своего потолка */
  const lintelUnder = (h: Hole) => h.top < CA - B - h.dz - 1e-6;
  // половины проёмов без перемычки (проём не ниже потолка) — под плиту потолка
  const plates: Rect[] = [];
  const solids: Solid[] = [];
  for (const s of piece.solids) {
    if (s.kind !== 'lintel') {
      solids.push({ ...s, z0: r6(s.z0 + B), z1: r6(s.z1 + R + B + X) });
      continue;
    }
    const h = holeAt(s.rect);
    if (!h?.custom) solids.push({ ...s, z0: r6(s.z0 + (h?.dz ?? 0) + B), z1: r6(s.z1 + R + B + X) });
    else if (lintelUnder(h)) solids.push({ ...s, z0: r6(B + h.dz + h.top), z1: r6(s.z1 + R + B + X) });
    else plates.push({ ...s.rect });
  }
  // половины проёмов (пол, потолок без перемычек) — по высоте своей метки; под поднятой половиной — стена
  const split = (list: Surface[], up: number): Surface[] =>
    list.flatMap((s) => {
      if (s.inst !== null) return [{ ...s, z: r6(s.z + up + B) }];
      const by = new Map<number, Rect[]>();
      for (const r of s.rects) {
        const dz = dzAt(r);
        by.set(dz, [...(by.get(dz) ?? []), r]);
      }
      return [...by].map(([dz, rects]) => ({ ...s, rects, z: r6(s.z + dz + B) }));
    });
  const floors = split(piece.floors, 0);
  // потолок проёма (без перемычек: doorHeightM ≥ wallHeightM) у высокого проёма — перемычка своей половины или плита
  // своего потолка; у обычного — как раньше
  const ceilings = split(piece.ceilings.flatMap((s): Surface[] => {
    if (s.inst !== null) return [s];
    const rest = s.rects.filter((r) => {
      const h = holeAt(r);
      if (!h?.custom) return true;
      if (lintelUnder(h)) solids.push({ kind: 'lintel', rect: { ...r }, z0: r6(B + h.dz + h.top), z1: r6(CA + slab), inst: id });
      else plates.push({ ...r });
      return false;
    });
    return rest.length ? [{ ...s, rects: rest }] : [];
  }), R + X);
  if (plates.length && piece.options?.ceilings !== false) ceilings.push({ inst: null, owner: id, rects: plates, finish: null, z: r6(CA) });
  for (const f of piece.floors) {
    if (f.inst !== null || f.owner !== id) continue;
    for (const r of f.rects) {
      const dz = dzAt(r);
      if (dz > 1e-6) solids.push({ kind: 'wall', rect: { ...r }, z0: r6(-slab + B), z1: r6(dz - slab + B), inst: id });
    }
  }
  const faces: WallFace[] = piece.faces.flatMap((f): WallFace[] => {
    if (f.part !== 'lintel') return [{ ...f, z0: r6(f.z0 + B), z1: r6(f.z1 + R + B + X) }];
    const h = holeAtLine(f.line);
    if (!h?.custom) return [{ ...f, z0: r6(f.z0 + (h?.dz ?? 0) + B), z1: r6(f.z1 + R + B + X) }];
    return lintelUnder(h) ? [{ ...f, z0: r6(B + h.dz + h.top), z1: r6(f.z1 + R + B + X) }] : [];
  });
  // высота дверей и тупиков высоких проёмов: у проёма связи — общий верх, у свободной метки — свой
  const topOf = new Map<string, number>();
  for (const h of ops) if (h.custom) topOf.set(h.conn, h.top);
  for (const k of inst.connectors ?? []) if (!topOf.has(k.id) && ownCustom(k)) topOf.set(k.id, ownTop(k));
  const atConn = <T extends DeadEnd | DoorSlot>(d: T): T => {
    const dz = dzOf.get(d.connector) ?? 0;
    const t = topOf.get(d.connector);
    if (!dz && t === undefined) return d;
    return { ...d, ...(dz ? { z: r6(B + dz) } : {}), ...(t !== undefined ? { heightM: r6(t) } : {}) };
  };
  const openings = piece.openings.map((o, i) => (ops[i].custom ? { ...o, heightM: r6(ops[i].top) } : o));
  const geo = inst.stair ? stairGeo(inst, piece, c, B) : null;
  const props: PropBox[] = piece.props.map((p) => {
    // подвесные — под потолком (зал с лестницей — над подъёмом, свой потолок — выше)
    if (p.tags.includes('потолок')) return R || X ? { ...p, z: r6(B + R + X) } : p;
    if (!R) return p;
    const z = stairFloorAt(geo ? [geo] : [], p.x, p.y)?.z;
    return z !== undefined && z > B + 1e-6 ? { ...p, z: r6(z) } : p;
  });
  return {
    ...piece,
    solids,
    floors,
    ceilings,
    faces,
    openings,
    props,
    deadEnds: piece.deadEnds.map(atConn),
    ...(piece.doors ? { doors: piece.doors.map(atConn) } : {}),
    ...(geo ? { stairs: [geo] } : {}),
  };
}

/** Лестница экземпляра в куске: марши и площадки (план, м; высоты абсолютные), перила у обрывов. */
function stairGeo(inst: RunInstance, piece: BlockoutModel, c: number, B: number): StairGeo {
  const st = inst.stair!;
  const m = (q: { x0: number; y0: number; x1: number; y1: number }): Rect => ({ x0: r6(q.x0 * c), y0: r6(q.y0 * c), x1: r6(q.x1 * c), y1: r6(q.y1 * c) });
  const flip: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const flights: Flight[] = (st.flights ?? []).map((f) => {
    // «вверх» — к большей высоте
    const rev = num(f.z1) < num(f.z0);
    const z0 = Math.min(num(f.z0), num(f.z1)), z1 = Math.max(num(f.z0), num(f.z1));
    return {
      rect: m(f), up: rev ? flip[f.up] : f.up, z0: r6(z0 + B), z1: r6(z1 + B), steps: Math.max(1, Math.round((z1 - z0) / 0.15)),
      // эскалатор (метро): ступени и балюстраду рисует модуль биома, здесь — только пандус, опора и коллайдеры перил
      ...(f.style === 'escalator' ? { style: 'escalator' as const } : {}),
    };
  });
  const pads = (st.pads ?? []).map((p) => ({ rect: m(p), z: r6(num(p.z) + B) }));
  const geo: StairGeo = { inst: inst.id, base: B, flights, pads, rails: [] };
  const floor = piece.floors.filter((s) => s.inst === inst.id).flatMap((s) => s.rects);
  const surf = (x: number, y: number) => stairFloorAt([geo], x, y)?.z ?? B;
  /** Перила вдоль края: от точки p по единичному d длиной len, наружу n; высота пола края hf(u); открыто, где снаружи —
   *  пол комнаты ниже края на DROP. Ломаная — по точкам излома hf (kinks) и концам открытых участков. hidden — только
   *  коллайдер (бок эскалатора). */
  const edge = (p: [number, number], d: [number, number], n: [number, number], len: number, hf: (u: number) => number, kinks: number[], hidden = false) => {
    const step = c;
    let run: number[] | null = null;
    let low = Infinity;
    const flush = (end: number) => {
      if (!run) return;
      const u0 = run[0];
      const us = [u0, ...kinks.filter((k) => k > u0 + 1e-6 && k < end - 1e-6), end];
      const pts = us.map((u): [number, number, number] => [r6(p[0] + d[0] * u - n[0] * RAIL_IN), r6(p[1] + d[1] * u - n[1] * RAIL_IN), r6(hf(u))]);
      if (end - u0 > 0.15) geo.rails.push({ pts, low: r6(low), ...(hidden ? { hidden: true as const } : {}) });
      run = null;
      low = Infinity;
    };
    for (let u = step / 2; u < len; u += step) {
      const ox = p[0] + d[0] * u + n[0] * 0.05, oy = p[1] + d[1] * u + n[1] * 0.05;
      const below = inRects(floor, ox, oy) ? surf(ox, oy) : Infinity;
      if (below < hf(u) - DROP) {
        if (!run) run = [Math.max(0, u - step / 2)];
        low = Math.min(low, below);
      } else flush(u - step / 2);
    }
    flush(len);
  };
  for (const f of flights) {
    const { L, W, t, r } = axes(f, f.rect.x0, f.rect.y0);
    const hf = (s: number) => noseZ(f, s, t, r);
    const kink = (f.steps - 1) * t;
    for (const [a, out] of [[0, -1], [W, 1]] as const) {
      const p0 = at(f, 0, a), p1 = at(f, 1, a), q = at(f, 0, a + out);
      edge(p0, [p1[0] - p0[0], p1[1] - p0[1]], [q[0] - p0[0], q[1] - p0[1]], L, hf, [kink], f.style === 'escalator');
    }
  }
  for (const pd of pads) {
    const { x0, y0, x1, y1 } = pd.rect;
    const hf = () => pd.z;
    edge([x0, y0], [1, 0], [0, -1], x1 - x0, hf, []);
    edge([x0, y1], [1, 0], [0, 1], x1 - x0, hf, []);
    edge([x0, y0], [0, 1], [-1, 0], y1 - y0, hf, []);
    edge([x1, y0], [0, 1], [1, 0], y1 - y0, hf, []);
  }
  return geo;
}

// ───────────────────────── меши (простые массивы, Babylon-координаты) ─────────────────────────

type V3 = [number, number, number];

/** Накопитель вершин как у BoxBatch (babylon.ts): позиции, нормали, UV, цвета, индексы; любые выпуклые грани. */
export class StairBatch {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly uv: number[] = [];
  readonly c: number[] = [];
  readonly i: number[] = [];
  color: [number, number, number, number] = [1, 1, 1, 1];

  /** Выпуклый многоугольник (Babylon), from — точка внутри тела: нормаль — от неё. Вырожденный — пропускается. */
  poly(pts0: V3[], from: V3) {
    // совпадающие соседние вершины — прочь: вырожденные треугольники коллайдер Babylon считает «плоскостью без нормали»
    const pts = pts0.filter((v, k) => {
      const w = pts0[(k + 1) % pts0.length];
      return Math.abs(v[0] - w[0]) + Math.abs(v[1] - w[1]) + Math.abs(v[2] - w[2]) > 1e-7;
    });
    if (pts.length < 3) return;
    // нормаль Ньюэлла
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    nx /= len; ny /= len; nz /= len;
    const cx = pts.reduce((s, v) => s + v[0], 0) / pts.length, cy = pts.reduce((s, v) => s + v[1], 0) / pts.length, cz = pts.reduce((s, v) => s + v[2], 0) / pts.length;
    if ((cx - from[0]) * nx + (cy - from[1]) * ny + (cz - from[2]) * nz < 0) {
      nx = -nx; ny = -ny; nz = -nz;
    }
    const base = this.p.length / 3;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    for (const v of pts) {
      this.p.push(v[0], v[1], v[2]);
      this.n.push(nx, ny, nz);
      this.uv.push(...((ax >= ay && ax >= az ? [v[2], v[1]] : ay >= az ? [v[0], v[2]] : [v[0], v[1]]) as [number, number]));
      this.c.push(...this.color);
    }
    // лицевая сторона (левая система Babylon): cross(p1 − p0, p2 − p0) смотрит ПРОТИВ внешней нормали
    for (let k = 1; k + 1 < pts.length; k++) {
      const a = pts[0], b = pts[k], d = pts[k + 1];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
      if (dot < 0) this.i.push(base, base + k, base + k + 1);
      else this.i.push(base, base + k + 1, base + k);
    }
  }

  /** Шестигранник: низ b[0..3] и верх t[0..3] по кругу в одном порядке; цвета верха и боков. */
  hexa(b: V3[], t: V3[], top: [number, number, number, number], side: [number, number, number, number]) {
    const all = [...b, ...t];
    const mid: V3 = [all.reduce((s, v) => s + v[0], 0) / 8, all.reduce((s, v) => s + v[1], 0) / 8, all.reduce((s, v) => s + v[2], 0) / 8];
    this.color = side;
    this.poly([b[0], b[1], b[2], b[3]], mid);
    for (let k = 0; k < 4; k++) this.poly([b[k], b[(k + 1) % 4], t[(k + 1) % 4], t[k]], mid);
    this.color = top;
    this.poly([t[0], t[1], t[2], t[3]], mid);
  }

  /** Бокс по прямоугольнику плана и отметкам (план → Babylon). */
  planBox(q: Rect, z0: number, z1: number, top: [number, number, number, number], side: [number, number, number, number]) {
    if (!(z1 - z0 > 1e-6)) return;
    const c4 = (z: number): V3[] => [[q.x0, z, -q.y0], [q.x1, z, -q.y0], [q.x1, z, -q.y1], [q.x0, z, -q.y1]];
    this.hexa(c4(z0), c4(z1), top, side);
  }

  get empty(): boolean {
    return this.i.length === 0;
  }
}

const rgb = (hex: string, a = 1): [number, number, number, number] => {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, a];
};
const C_TREAD = rgb('#aaa59b');
const C_RISER = rgb('#8a857c');
const C_PAD = rgb('#9f9a90');
const C_METAL = rgb('#2e3033');
const C_RAIL = rgb('#4a3426');

/** Меши лестниц: видимые ступени и перила (без коллизий), площадки (видимые, с коллизиями), невидимый коллайдер —
 *  пандус по линии носков и стенки перил. У эскалатора (style 'escalator') видимых ступеней и перил по бокам нет —
 *  их рисует модуль метро; пандус и стенки перил — как у лестницы. */
export function stairMeshes(geos: readonly StairGeo[]): { visible: StairBatch; pads: StairBatch; collider: StairBatch } {
  const visible = new StairBatch(), pads = new StairBatch(), collider = new StairBatch();
  const B3 = (x: number, y: number, z: number): V3 => [x, z, -y];
  for (const g of geos) {
    for (const p of g.pads) pads.planBox(p.rect, g.base, p.z, C_PAD, C_RISER);
    for (const f of g.flights) {
      const { L, W, t, r } = axes(f, f.rect.x0, f.rect.y0);
      // ступени: k-я — от низа комнаты до z0 + k·r, проступь [(k − 1)·t, k·t] (у эскалатора — ни одной)
      const shown = f.style === 'escalator' ? 0 : f.steps;
      for (let k = 1; k <= shown; k++) {
        const a = at(f, (k - 1) * t, 0), b = at(f, k * t, W);
        const q: Rect = { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
        visible.planBox(q, g.base, f.z0 + k * r, C_TREAD, C_RISER);
      }
      // пандус: от пола за проступь до марша (z0) к верху последней ступени (z1), дальше ровно до верхнего края
      const kink = (f.steps - 1) * t;
      const quad = (s0: number, s1: number, z0: number, z1: number) => {
        const c0 = at(f, s0, 0), c1 = at(f, s1, 0), c2 = at(f, s1, W), c3 = at(f, s0, W);
        collider.hexa(
          [B3(c0[0], c0[1], g.base), B3(c1[0], c1[1], g.base), B3(c2[0], c2[1], g.base), B3(c3[0], c3[1], g.base)],
          [B3(c0[0], c0[1], z0), B3(c1[0], c1[1], z1), B3(c2[0], c2[1], z1), B3(c3[0], c3[1], z0)],
          C_TREAD, C_RISER,
        );
      };
      quad(-t, kink, f.z0, f.z1);
      if (L - kink > 1e-6) quad(kink, L, f.z1, f.z1);
    }
    for (const rl of g.rails) {
      const pts = rl.pts;
      for (let k = 0; k + 1 < pts.length; k++) {
        const [ax, ay, az] = pts[k], [bx, by, bz] = pts[k + 1];
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 1e-6) continue;
        // поперёк отрезка (план)
        const qx = -(by - ay) / len, qy = (bx - ax) / len;
        const bar = (w: number, z0a: number, z0b: number, z1a: number, z1b: number, into: StairBatch, col: [number, number, number, number]) =>
          into.hexa(
            [B3(ax - qx * w, ay - qy * w, z0a), B3(bx - qx * w, by - qy * w, z0b), B3(bx + qx * w, by + qy * w, z0b), B3(ax + qx * w, ay + qy * w, z0a)],
            [B3(ax - qx * w, ay - qy * w, z1a), B3(bx - qx * w, by - qy * w, z1b), B3(bx + qx * w, by + qy * w, z1b), B3(ax + qx * w, ay + qy * w, z1a)],
            col, col,
          );
        // поручень и нижняя полоса, стенка-коллайдер (у эскалатора — только она)
        bar(0.03, rl.low, rl.low, az + RAIL_COL_H, bz + RAIL_COL_H, collider, C_METAL);
        if (rl.hidden) continue;
        bar(0.025, az + RAIL_H - 0.05, bz + RAIL_H - 0.05, az + RAIL_H, bz + RAIL_H, visible, C_RAIL);
        bar(0.012, az + 0.08, bz + 0.08, az + 0.11, bz + 0.11, visible, C_METAL);
        // стойки — через POST_STEP (и на концах)
        const n = Math.max(1, Math.round(len / POST_STEP));
        for (let j = k === 0 ? 0 : 1; j <= n; j++) {
          const u = j / n, x = ax + (bx - ax) * u, y = ay + (by - ay) * u, z = az + (bz - az) * u;
          const q: Rect = { x0: x - 0.018, y0: y - 0.018, x1: x + 0.018, y1: y + 0.018 };
          visible.planBox(q, z - 0.12, z + RAIL_H - 0.05, C_METAL, C_METAL);
        }
      }
    }
  }
  return { visible, pads, collider };
}
